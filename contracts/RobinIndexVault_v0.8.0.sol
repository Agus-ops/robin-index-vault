// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

// ============================================================
// RobinIndexVault v0.8.0 — Perubahan: hapus pengecekan isStock
// ============================================================
// Tujuan: Memungkinkan token settlement (USDG) dideposit,
//         tidak hanya token saham.
// Perubahan utama:
//   1. Hapus baris "if (!cfg.isStock) revert NotStockToken()" di deposit()
//   2. Tambahkan getPriceData() ke interface IStockOracle
//   3. Hapus error NotStockToken yang tidak terpakai
//   4. Tambahkan nonReentrant di dailyRebalanceCheck()
// ============================================================

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IStockOracle {
    function getPrice(address token) external view returns (uint256);
    function isFresh(address token) external view returns (bool);
    function PRICE_DECIMALS() external view returns (uint8);
    function getPriceData(address token) external view returns (uint256 price, uint256 updatedAt, bool supported);
}

interface IReceiptToken {
    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;
}

interface IFeeTreasuryReceiver {
    function receiveFee(address token, uint256 amount) external;
}

contract RobinIndexVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------- Constants ----------
    uint256 public constant BPS = 10_000;
    uint16 public constant MAX_FEE_BPS = 1_000; // 10%
    uint256 public constant DAILY_REBALANCE_COOLDOWN = 24 hours;

    // ---------- Structs ----------
    struct TokenConfig {
        bool supported;
        bool isStock;
        bool isSettlement;
        uint8 decimals;
    }

    struct FeeConfig {
        uint16 depositFeeBps;       // 30 = 0.30%
        uint16 withdrawFeeBps;      // 20 = 0.20%
        uint16 earlyWithdrawFeeBps; // 100 = 1.00%
        uint256 minHoldTime;        // e.g. 1 day / 3 days
    }

    // ---------- Core addresses ----------
    IStockOracle public oracle;
    IReceiptToken public receiptToken;
    address public treasury;
    bool public paused;

    // ---------- Roles ----------
    mapping(address => bool) public keepers;
    mapping(address => bool) public pausers;

    // ---------- Token config ----------
    mapping(address => TokenConfig) public tokenConfigs;

    // ---------- User ledger accounting ----------
    mapping(address => mapping(address => uint256)) public userBalances;
    mapping(address => mapping(address => uint256)) public userTotalDeposited;
    mapping(address => mapping(address => uint256)) public userTotalWithdrawn;
    mapping(address => mapping(address => uint256)) public userReceiptByToken;

    mapping(address => address[]) private _userTokens;
    mapping(address => mapping(address => bool)) private _userTokenExists;

    mapping(address => uint256) public totalTokenDeposits;
    mapping(address => uint256) public pendingFees;

    mapping(address => bool) public hasEverDeposited;
    mapping(address => uint256) public lastDepositAt;
    mapping(address => mapping(address => uint256)) public lastTokenDepositAt;
    mapping(address => uint256) public lastRebalanceAt;
    uint256 public totalUsers;

    FeeConfig public feeConfig;

    // ---------- Errors ----------
    error NotOwner();
    error NotKeeper();
    error NotPauser();
    error NotAuthorized();
    error ZeroAddress();
    error InvalidAmount();
    error InvalidFee();
    error InvalidDecimals();
    error UnsupportedToken();
    error OracleStale();
    error InsufficientBalance();
    error TransferFailed();
    error TreasuryNotSet();
    error NoFees();
    error Paused();
    error AlreadyInitialized();
    error TokenHasBalances();
    error ZeroReceiptMinted();
    error CooldownActive();

    // ---------- Events ----------
    event KeeperUpdated(address indexed keeper, bool allowed);
    event PauserUpdated(address indexed pauser, bool allowed);
    event TokenConfigured(address indexed token, bool supported, bool isStock, bool isSettlement, uint8 decimals);
    event Deposited(address indexed user, address indexed token, uint256 amountIn, uint256 feeAmount, uint256 creditedAmount, uint256 mintedRIndex, uint256 priceUsd, uint256 timestamp);
    event Withdrawn(address indexed user, address indexed token, uint256 requestedAmount, uint256 feeAmount, uint256 returnedAmount, uint256 burnedRIndex, uint256 timestamp);
    event ReceiptBurned(address indexed user, address indexed token, uint256 amount);
    event DailyRebalanceCheck(address indexed user, string strategy, uint256 portfolioValueUsd18, bool allPricesFresh, uint256 timestamp);
    event FeesSwept(address indexed token, uint256 amount, address indexed treasury);
    event FeeConfigUpdated(uint16 depositFeeBps, uint16 withdrawFeeBps, uint16 earlyWithdrawFeeBps, uint256 minHoldTime);
    event OracleUpdated(address indexed oldOracle, address indexed newOracle);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event ReceiptTokenUpdated(address indexed oldReceiptToken, address indexed newReceiptToken);
    event PausedStateUpdated(bool paused, address indexed account);
    event UnsupportedTokenRecovered(address indexed token, address indexed to, uint256 amount);

    // ---------- Modifiers ----------
    modifier onlyKeeperOrOwner() {
        if (msg.sender != owner() && !keepers[msg.sender]) revert NotKeeper();
        _;
    }
    modifier onlyPauserOrOwner() {
        if (msg.sender != owner() && !pausers[msg.sender]) revert NotPauser();
        _;
    }
    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    // ---------- Constructor ----------
    constructor(
        address _oracle,
        address _receiptToken,
        address _treasury
    ) Ownable(msg.sender) {
        if (_oracle == address(0) || _receiptToken == address(0)) revert ZeroAddress();
        oracle = IStockOracle(_oracle);
        receiptToken = IReceiptToken(_receiptToken);
        treasury = _treasury;

        feeConfig = FeeConfig({
            depositFeeBps: 30,
            withdrawFeeBps: 20,
            earlyWithdrawFeeBps: 100,
            minHoldTime: 1 days
        });

        emit OracleUpdated(address(0), _oracle);
        emit ReceiptTokenUpdated(address(0), _receiptToken);
        emit TreasuryUpdated(address(0), _treasury);
        emit FeeConfigUpdated(30, 20, 100, 1 days);
    }

    // ---------- Admin ----------
    function setOracle(address _oracle) external onlyOwner {
        if (_oracle == address(0)) revert ZeroAddress();
        emit OracleUpdated(address(oracle), _oracle);
        oracle = IStockOracle(_oracle);
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, _treasury);
        treasury = _treasury;
    }

    function setReceiptToken(address _receiptToken) external onlyOwner {
        if (_receiptToken == address(0)) revert ZeroAddress();
        if (totalUsers != 0) revert AlreadyInitialized();
        emit ReceiptTokenUpdated(address(receiptToken), _receiptToken);
        receiptToken = IReceiptToken(_receiptToken);
    }

    function addKeeper(address keeper) external onlyOwner {
        if (keeper == address(0)) revert ZeroAddress();
        keepers[keeper] = true;
        emit KeeperUpdated(keeper, true);
    }

    function removeKeeper(address keeper) external onlyOwner {
        keepers[keeper] = false;
        emit KeeperUpdated(keeper, false);
    }

    function setPauser(address pauser, bool allowed) external onlyOwner {
        if (pauser == address(0)) revert ZeroAddress();
        pausers[pauser] = allowed;
        emit PauserUpdated(pauser, allowed);
    }

    function pause() external onlyPauserOrOwner {
        paused = true;
        emit PausedStateUpdated(true, msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit PausedStateUpdated(false, msg.sender);
    }

    function configureToken(
        address token,
        bool supported,
        bool isStock,
        bool isSettlement,
        uint8 decimals_
    ) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        if (decimals_ > 18) revert InvalidDecimals();
        if (supported && !isStock && !isSettlement) revert UnsupportedToken();
        if (isStock && isSettlement) revert UnsupportedToken();

        if (!supported) {
            if (totalTokenDeposits[token] != 0 || pendingFees[token] != 0) revert TokenHasBalances();
        }

        tokenConfigs[token] = TokenConfig({
            supported: supported,
            isStock: isStock,
            isSettlement: isSettlement,
            decimals: decimals_
        });

        emit TokenConfigured(token, supported, isStock, isSettlement, decimals_);
    }

    function setFeeConfig(
        uint16 depositFeeBps,
        uint16 withdrawFeeBps,
        uint16 earlyWithdrawFeeBps,
        uint256 minHoldTime
    ) external onlyOwner {
        if (depositFeeBps > MAX_FEE_BPS || withdrawFeeBps > MAX_FEE_BPS || earlyWithdrawFeeBps > MAX_FEE_BPS) revert InvalidFee();
        feeConfig = FeeConfig({
            depositFeeBps: depositFeeBps,
            withdrawFeeBps: withdrawFeeBps,
            earlyWithdrawFeeBps: earlyWithdrawFeeBps,
            minHoldTime: minHoldTime
        });
        emit FeeConfigUpdated(depositFeeBps, withdrawFeeBps, earlyWithdrawFeeBps, minHoldTime);
    }

    // ---------- Deposit ----------
    function deposit(address token, uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert InvalidAmount();

        TokenConfig memory cfg = tokenConfigs[token];
        if (!cfg.supported) revert UnsupportedToken();
        // v0.8.0: HAPUS PENGECEKAN isStock
        // Semua token supported bisa dideposit, termasuk settlement (USDG)

        if (!oracle.isFresh(token)) revert OracleStale();

        uint256 priceUsd = oracle.getPrice(token);

        uint256 balBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 balAfter = IERC20(token).balanceOf(address(this));
        uint256 receivedAmount = balAfter - balBefore;
        if (receivedAmount == 0) revert InvalidAmount();

        uint256 feeAmount = (receivedAmount * feeConfig.depositFeeBps) / BPS;
        uint256 creditedAmount = receivedAmount - feeAmount;
        if (creditedAmount == 0) revert InvalidAmount();

        uint256 mintedRIndex = _toUsd18(token, creditedAmount, priceUsd);
        if (mintedRIndex == 0) revert ZeroReceiptMinted();

        if (!_userTokenExists[msg.sender][token]) {
            _userTokenExists[msg.sender][token] = true;
            _userTokens[msg.sender].push(token);
        }

        if (!hasEverDeposited[msg.sender]) {
            hasEverDeposited[msg.sender] = true;
            totalUsers += 1;
        }

        userBalances[msg.sender][token] += creditedAmount;
        userTotalDeposited[msg.sender][token] += creditedAmount;
        userReceiptByToken[msg.sender][token] += mintedRIndex;

        totalTokenDeposits[token] += creditedAmount;
        pendingFees[token] += feeAmount;

        lastDepositAt[msg.sender] = block.timestamp;
        lastTokenDepositAt[msg.sender][token] = block.timestamp;

        receiptToken.mint(msg.sender, mintedRIndex);

        emit Deposited(msg.sender, token, receivedAmount, feeAmount, creditedAmount, mintedRIndex, priceUsd, block.timestamp);
    }

    // ---------- Withdraw ----------
    function withdraw(address token, uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();

        uint256 bal = userBalances[msg.sender][token];
        if (bal < amount) revert InsufficientBalance();

        (uint256 feeAmount, uint256 returnedAmount, uint256 burnAmount) = _previewWithdraw(msg.sender, token, amount, bal);

        userBalances[msg.sender][token] = bal - amount;
        userTotalWithdrawn[msg.sender][token] += amount;
        userReceiptByToken[msg.sender][token] -= burnAmount;

        totalTokenDeposits[token] -= amount;
        pendingFees[token] += feeAmount;

        receiptToken.burn(msg.sender, burnAmount);
        IERC20(token).safeTransfer(msg.sender, returnedAmount);

        emit ReceiptBurned(msg.sender, token, burnAmount);
        emit Withdrawn(msg.sender, token, amount, feeAmount, returnedAmount, burnAmount, block.timestamp);
    }

    // ---------- Daily check-in ----------
    function dailyRebalanceCheck(string calldata strategy) external nonReentrant whenNotPaused {
        if (!hasEverDeposited[msg.sender]) revert InsufficientBalance();

        uint256 last = lastRebalanceAt[msg.sender];
        if (last != 0 && block.timestamp < last + DAILY_REBALANCE_COOLDOWN) revert CooldownActive();

        (uint256 valueUsd18, bool allPricesFresh) = _getUserPortfolioValueUsd(msg.sender);
        lastRebalanceAt[msg.sender] = block.timestamp;

        emit DailyRebalanceCheck(msg.sender, strategy, valueUsd18, allPricesFresh, block.timestamp);
    }

    // ---------- Sweep fees ----------
    function sweepFees(address token) external nonReentrant onlyKeeperOrOwner {
        if (treasury == address(0)) revert TreasuryNotSet();

        uint256 amount = pendingFees[token];
        if (amount == 0) revert NoFees();

        pendingFees[token] = 0;
        IERC20(token).safeTransfer(treasury, amount);
        IFeeTreasuryReceiver(treasury).receiveFee(token, amount);

        emit FeesSwept(token, amount, treasury);
    }

    // ---------- Emergency recovery ----------
    function recoverUnsupportedToken(address token, address to, uint256 amount) external nonReentrant onlyOwner {
        if (token == address(0) || to == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();

        TokenConfig memory cfg = tokenConfigs[token];
        if (cfg.supported) revert UnsupportedToken();
        if (totalTokenDeposits[token] != 0 || pendingFees[token] != 0) revert TokenHasBalances();

        IERC20(token).safeTransfer(to, amount);
        emit UnsupportedTokenRecovered(token, to, amount);
    }

    // ---------- View functions ----------
    function getUserTokens(address user) external view returns (address[] memory) {
        return _userTokens[user];
    }

    function getUserReceiptByToken(address user, address token) external view returns (uint256) {
        return userReceiptByToken[user][token];
    }

    function getUserPortfolioValueUsd(address user) external view returns (uint256 valueUsd18, bool allPricesFresh) {
        return _getUserPortfolioValueUsd(user);
    }

    function previewDeposit(address token, uint256 amount) external view returns (
        uint256 feeAmount,
        uint256 creditedAmount,
        uint256 mintedRIndex,
        uint256 priceUsd,
        bool isPriceFresh
    ) {
        if (amount == 0) revert InvalidAmount();
        TokenConfig memory cfg = tokenConfigs[token];
        if (!cfg.supported) revert UnsupportedToken();

        feeAmount = (amount * feeConfig.depositFeeBps) / BPS;
        creditedAmount = amount - feeAmount;
        uint256 oraclePrice = oracle.getPrice(token);
        priceUsd = oraclePrice;
        isPriceFresh = oraclePrice != 0 && oracle.isFresh(token);
        if (oraclePrice != 0 && creditedAmount != 0) {
            mintedRIndex = _toUsd18(token, creditedAmount, oraclePrice);
        }
    }

    function previewWithdraw(address user, address token, uint256 amount) external view returns (
        uint256 feeAmount,
        uint256 returnedAmount,
        uint256 burnedRIndex
    ) {
        if (amount == 0) revert InvalidAmount();
        uint256 bal = userBalances[user][token];
        if (bal < amount) revert InsufficientBalance();
        return _previewWithdraw(user, token, amount, bal);
    }

    // ---------- Internal ----------
    function _previewWithdraw(address user, address token, uint256 amount, uint256 balanceBefore) internal view returns (
        uint256 feeAmount,
        uint256 returnedAmount,
        uint256 burnAmount
    ) {
        uint16 feeBps = _withdrawFeeBps(user, token);
        feeAmount = (amount * feeBps) / BPS;
        returnedAmount = amount - feeAmount;

        uint256 receiptForToken = userReceiptByToken[user][token];
        if (amount == balanceBefore) {
            burnAmount = receiptForToken;
        } else {
            burnAmount = (receiptForToken * amount) / balanceBefore;
        }
        if (burnAmount == 0 && receiptForToken != 0) {
            burnAmount = 1;
        }
    }

    function _withdrawFeeBps(address user, address token) internal view returns (uint16) {
        uint256 tokenLastDeposit = lastTokenDepositAt[user][token];
        if (tokenLastDeposit != 0 && block.timestamp < tokenLastDeposit + feeConfig.minHoldTime) {
            return feeConfig.earlyWithdrawFeeBps;
        }
        return feeConfig.withdrawFeeBps;
    }

    function _toUsd18(address token, uint256 tokenAmount, uint256 priceUsd) internal view returns (uint256) {
        TokenConfig memory cfg = tokenConfigs[token];
        uint8 priceDecimals = oracle.PRICE_DECIMALS();
        uint256 priceScale = 10 ** uint256(18 - priceDecimals);
        uint256 tokenScale = 10 ** uint256(cfg.decimals);
        return (tokenAmount * priceUsd * priceScale) / tokenScale;
    }

    function _getUserPortfolioValueUsd(address user) internal view returns (uint256 valueUsd18, bool allPricesFresh) {
        address[] storage tokens = _userTokens[user];
        allPricesFresh = true;

        for (uint256 i = 0; i < tokens.length; i++) {
            address token = tokens[i];
            uint256 bal = userBalances[user][token];
            if (bal == 0) continue;

            uint256 priceUsd = oracle.getPrice(token);
            bool fresh = priceUsd != 0 && oracle.isFresh(token);
            if (!fresh) allPricesFresh = false;
            if (priceUsd != 0) {
                valueUsd18 += _toUsd18(token, bal, priceUsd);
            }
        }
    }
}
