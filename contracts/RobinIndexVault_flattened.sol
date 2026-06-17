// Sources flattened with hardhat v2.28.6 https://hardhat.org

// SPDX-License-Identifier: MIT

// File contracts/interfaces/IReceiptToken.sol

// Original license: SPDX_License_Identifier: MIT
pragma solidity ^0.8.24;

interface IReceiptToken {
    event VaultUpdated(address indexed oldVault, address indexed newVault);

    error NonTransferable();
    error NotVault();

    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function vault() external view returns (address);

    function setVault(address newVault) external;
    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;

    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external returns (bool);
}


// File contracts/interfaces/IStockOracle.sol

// Original license: SPDX_License_Identifier: MIT

interface IStockOracle {
    struct PriceData {
        uint256 priceUsd;
        uint256 updatedAt;
        bool supported;
    }

    event PriceUpdated(address indexed token, uint256 priceUsd, uint256 updatedAt);
    event KeeperUpdated(address indexed keeper, bool allowed);
    event MaxStaleTimeUpdated(uint256 oldMaxStaleTime, uint256 newMaxStaleTime);

    function PRICE_DECIMALS() external view returns (uint8);
    function maxStaleTime() external view returns (uint256);

    function getPrice(address token) external view returns (uint256 priceUsd);

    function getPriceData(address token) external view returns (
        uint256 priceUsd,
        uint256 updatedAt,
        bool supported
    );

    function lastUpdated(address token) external view returns (uint256);
    function isFresh(address token) external view returns (bool);
    function isSupported(address token) external view returns (bool);

    function setPrice(address token, uint256 priceUsd) external;

    function setPrices(
        address[] calldata tokens,
        uint256[] calldata pricesUsd
    ) external;

    function setSupportedToken(address token, bool supported) external;
    function setKeeper(address keeper, bool allowed) external;
    function setMaxStaleTime(uint256 newMaxStaleTime) external;
}


// File contracts/RobinIndexVault.sol

// Original license: SPDX_License_Identifier: MIT


interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IFeeTreasuryReceiver {
    function receiveFee(address token, uint256 amount) external;
}

/**
 * @title RobinIndexVault
 * @notice Ledger-based multi-token stock vault for Robinhood Chain Testnet.
 *
 * MVP principles:
 * - User balances are tracked per user per token.
 * - withdraw() returns the user's underlying token balance and MUST NOT depend on oracle/NAV.
 * - Oracle is only used for deposit receipt minting, portfolio NAV views, and rebalance-check display.
 * - rINDEX is non-transferable and acts as receipt/score, not a freely transferable vault share.
 * - Router/reward distribution are intentionally excluded from this module.
 */
contract RobinIndexVault {
    struct TokenConfig {
        bool supported;
        bool isStock;
        bool isSettlement;
        uint8 decimals;
    }

    struct FeeConfig {
        uint16 depositFeeBps;
        uint16 withdrawFeeBps;
        uint16 earlyWithdrawFeeBps;
        uint256 minHoldTime;
    }

    uint256 public constant BPS = 10_000;
    uint16 public constant MAX_FEE_BPS = 1_000;
    uint256 public constant DAILY_REBALANCE_COOLDOWN = 24 hours;

    address public owner;
    IStockOracle public oracle;
    IReceiptToken public receiptToken;
    address public treasury;

    bool public paused;

    mapping(address => bool) public keepers;
    mapping(address => bool) public pausers;

    mapping(address => TokenConfig) public tokenConfigs;

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

    error NotOwner();
    error NotKeeper();
    error NotPauser();
    error ZeroAddress();
    error InvalidAmount();
    error InvalidFee();
    error InvalidDecimals();
    error UnsupportedToken();
    error NotStockToken();
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

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event KeeperUpdated(address indexed keeper, bool allowed);
    event PauserUpdated(address indexed pauser, bool allowed);

    event TokenConfigured(
        address indexed token,
        bool supported,
        bool isStock,
        bool isSettlement,
        uint8 decimals
    );

    event Deposited(
        address indexed user,
        address indexed token,
        uint256 amountIn,
        uint256 feeAmount,
        uint256 creditedAmount,
        uint256 mintedRIndex,
        uint256 priceUsd,
        uint256 timestamp
    );

    event Withdrawn(
        address indexed user,
        address indexed token,
        uint256 requestedAmount,
        uint256 feeAmount,
        uint256 returnedAmount,
        uint256 burnedRIndex,
        uint256 timestamp
    );

    event ReceiptBurned(address indexed user, address indexed token, uint256 amount);

    event DailyRebalanceCheck(
        address indexed user,
        string strategy,
        uint256 portfolioValueUsd18,
        bool allPricesFresh,
        uint256 timestamp
    );

    event FeesSwept(address indexed token, uint256 amount, address indexed treasury);

    event FeeConfigUpdated(
        uint16 depositFeeBps,
        uint16 withdrawFeeBps,
        uint16 earlyWithdrawFeeBps,
        uint256 minHoldTime
    );

    event OracleUpdated(address indexed oldOracle, address indexed newOracle);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event ReceiptTokenUpdated(address indexed oldReceiptToken, address indexed newReceiptToken);
    event PausedStateUpdated(bool paused, address indexed account);
    event UnsupportedTokenRecovered(address indexed token, address indexed to, uint256 amount);

    uint256 private _entered = 1;

    modifier nonReentrant() {
        require(_entered == 1, "REENTRANCY");
        _entered = 2;
        _;
        _entered = 1;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyKeeperOrOwner() {
        if (msg.sender != owner && !keepers[msg.sender]) revert NotKeeper();
        _;
    }

    modifier onlyPauserOrOwner() {
        if (msg.sender != owner && !pausers[msg.sender]) revert NotPauser();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    constructor(
        address initialOwner,
        address oracle_,
        address receiptToken_,
        address treasury_
    ) {
        if (oracle_ == address(0)) revert ZeroAddress();
        if (receiptToken_ == address(0)) revert ZeroAddress();
        if (treasury_ == address(0)) revert ZeroAddress();

        address resolvedOwner = initialOwner == address(0) ? msg.sender : initialOwner;

        owner = resolvedOwner;
        oracle = IStockOracle(oracle_);
        receiptToken = IReceiptToken(receiptToken_);
        treasury = treasury_;

        feeConfig = FeeConfig({
            depositFeeBps: 30,
            withdrawFeeBps: 20,
            earlyWithdrawFeeBps: 100,
            minHoldTime: 1 days
        });

        emit OwnershipTransferred(address(0), resolvedOwner);
        emit OracleUpdated(address(0), oracle_);
        emit ReceiptTokenUpdated(address(0), receiptToken_);
        emit TreasuryUpdated(address(0), treasury_);
        emit FeeConfigUpdated(30, 20, 100, 1 days);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();

        address oldOwner = owner;
        owner = newOwner;

        emit OwnershipTransferred(oldOwner, newOwner);
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

    function setOracle(address newOracle) external onlyOwner {
        if (newOracle == address(0)) revert ZeroAddress();

        address oldOracle = address(oracle);
        oracle = IStockOracle(newOracle);

        emit OracleUpdated(oldOracle, newOracle);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();

        address oldTreasury = treasury;
        treasury = newTreasury;

        emit TreasuryUpdated(oldTreasury, newTreasury);
    }

    function setReceiptToken(address newReceiptToken) external onlyOwner {
        if (newReceiptToken == address(0)) revert ZeroAddress();
        if (totalUsers != 0) revert AlreadyInitialized();

        address oldReceiptToken = address(receiptToken);
        receiptToken = IReceiptToken(newReceiptToken);

        emit ReceiptTokenUpdated(oldReceiptToken, newReceiptToken);
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
            if (totalTokenDeposits[token] != 0 || pendingFees[token] != 0) {
                revert TokenHasBalances();
            }
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
        if (
            depositFeeBps > MAX_FEE_BPS ||
            withdrawFeeBps > MAX_FEE_BPS ||
            earlyWithdrawFeeBps > MAX_FEE_BPS
        ) {
            revert InvalidFee();
        }

        feeConfig = FeeConfig({
            depositFeeBps: depositFeeBps,
            withdrawFeeBps: withdrawFeeBps,
            earlyWithdrawFeeBps: earlyWithdrawFeeBps,
            minHoldTime: minHoldTime
        });

        emit FeeConfigUpdated(
            depositFeeBps,
            withdrawFeeBps,
            earlyWithdrawFeeBps,
            minHoldTime
        );
    }

    function deposit(address token, uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert InvalidAmount();

        TokenConfig memory cfg = tokenConfigs[token];
        if (!cfg.supported) revert UnsupportedToken();
        if (!cfg.isStock) revert NotStockToken();

        if (!oracle.isFresh(token)) revert OracleStale();

        uint256 priceUsd = oracle.getPrice(token);

        uint256 balBefore = IERC20Minimal(token).balanceOf(address(this));
        _safeTransferFrom(token, msg.sender, address(this), amount);
        uint256 balAfter = IERC20Minimal(token).balanceOf(address(this));

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

        emit Deposited(
            msg.sender,
            token,
            receivedAmount,
            feeAmount,
            creditedAmount,
            mintedRIndex,
            priceUsd,
            block.timestamp
        );
    }

    /**
     * @notice Withdraw user's underlying token balance.
     * @dev Critical invariant: withdraw() MUST NOT call oracle or NAV-dependent logic.
     */
    function withdraw(address token, uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();

        uint256 bal = userBalances[msg.sender][token];
        if (bal < amount) revert InsufficientBalance();

        (
            uint256 feeAmount,
            uint256 returnedAmount,
            uint256 burnAmount
        ) = _previewWithdraw(msg.sender, token, amount, bal);

        userBalances[msg.sender][token] = bal - amount;
        userTotalWithdrawn[msg.sender][token] += amount;
        userReceiptByToken[msg.sender][token] -= burnAmount;

        totalTokenDeposits[token] -= amount;
        pendingFees[token] += feeAmount;

        if (burnAmount != 0) {
            receiptToken.burn(msg.sender, burnAmount);
            emit ReceiptBurned(msg.sender, token, burnAmount);
        }

        _safeTransfer(token, msg.sender, returnedAmount);

        emit Withdrawn(
            msg.sender,
            token,
            amount,
            feeAmount,
            returnedAmount,
            burnAmount,
            block.timestamp
        );
    }

    /**
     * @notice User-callable daily portfolio check-in.
     * @dev This is NOT router execution and does not move funds.
     */
    function dailyRebalanceCheck(string calldata strategy) external whenNotPaused {
        if (!hasEverDeposited[msg.sender]) revert InsufficientBalance();

        uint256 last = lastRebalanceAt[msg.sender];
        if (last != 0 && block.timestamp < last + DAILY_REBALANCE_COOLDOWN) {
            revert CooldownActive();
        }

        (
            uint256 valueUsd18,
            bool allPricesFresh
        ) = getUserPortfolioValueUsd(msg.sender);

        lastRebalanceAt[msg.sender] = block.timestamp;

        emit DailyRebalanceCheck(
            msg.sender,
            strategy,
            valueUsd18,
            allPricesFresh,
            block.timestamp
        );
    }

    function sweepFees(address token) external nonReentrant onlyKeeperOrOwner {
        if (treasury == address(0)) revert TreasuryNotSet();

        uint256 amount = pendingFees[token];
        if (amount == 0) revert NoFees();

        pendingFees[token] = 0;

        _safeTransfer(token, treasury, amount);
        IFeeTreasuryReceiver(treasury).receiveFee(token, amount);

        emit FeesSwept(token, amount, treasury);
    }

    function getUserTokens(address user) external view returns (address[] memory) {
        return _userTokens[user];
    }

    function getUserReceiptByToken(address user, address token) external view returns (uint256) {
        return userReceiptByToken[user][token];
    }

    function previewDeposit(
        address token,
        uint256 amount
    )
        external
        view
        returns (
            uint256 feeAmount,
            uint256 creditedAmount,
            uint256 mintedRIndex,
            uint256 priceUsd,
            bool isPriceFresh
        )
    {
        if (amount == 0) revert InvalidAmount();

        TokenConfig memory cfg = tokenConfigs[token];
        if (!cfg.supported) revert UnsupportedToken();
        if (!cfg.isStock) revert NotStockToken();

        feeAmount = (amount * feeConfig.depositFeeBps) / BPS;
        creditedAmount = amount - feeAmount;

        (
            uint256 oraclePrice,
            ,
            bool oracleSupported
        ) = oracle.getPriceData(token);

        priceUsd = oraclePrice;
        isPriceFresh = oracleSupported && oraclePrice != 0 && oracle.isFresh(token);

        if (oraclePrice != 0 && creditedAmount != 0) {
            mintedRIndex = _toUsd18(token, creditedAmount, oraclePrice);
        }
    }

    function previewWithdraw(
        address user,
        address token,
        uint256 amount
    )
        external
        view
        returns (
            uint256 feeAmount,
            uint256 returnedAmount,
            uint256 burnedRIndex
        )
    {
        if (amount == 0) revert InvalidAmount();

        uint256 bal = userBalances[user][token];
        if (bal < amount) revert InsufficientBalance();

        return _previewWithdraw(user, token, amount, bal);
    }

    function getUserPortfolioValueUsd(
        address user
    )
        public
        view
        returns (
            uint256 valueUsd18,
            bool allPricesFresh
        )
    {
        address[] storage tokens = _userTokens[user];

        allPricesFresh = true;

        for (uint256 i = 0; i < tokens.length; i++) {
            address token = tokens[i];
            uint256 bal = userBalances[user][token];

            if (bal == 0) continue;

            (
                uint256 priceUsd,
                ,
                bool oracleSupported
            ) = oracle.getPriceData(token);

            bool fresh = oracleSupported && priceUsd != 0 && oracle.isFresh(token);

            if (!fresh) {
                allPricesFresh = false;
            }

            if (priceUsd != 0) {
                valueUsd18 += _toUsd18(token, bal, priceUsd);
            }
        }
    }

    function isKeeper(address account) external view returns (bool) {
        return keepers[account];
    }

    function isPauser(address account) external view returns (bool) {
        return pausers[account];
    }

    function recoverUnsupportedToken(
        address token,
        address to,
        uint256 amount
    ) external nonReentrant onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();

        TokenConfig memory cfg = tokenConfigs[token];

        if (cfg.supported) revert UnsupportedToken();
        if (totalTokenDeposits[token] != 0 || pendingFees[token] != 0) {
            revert TokenHasBalances();
        }

        _safeTransfer(token, to, amount);

        emit UnsupportedTokenRecovered(token, to, amount);
    }

    function _previewWithdraw(
        address user,
        address token,
        uint256 amount,
        uint256 balanceBefore
    )
        internal
        view
        returns (
            uint256 feeAmount,
            uint256 returnedAmount,
            uint256 burnAmount
        )
    {
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

        if (
            tokenLastDeposit != 0 &&
            block.timestamp < tokenLastDeposit + feeConfig.minHoldTime
        ) {
            return feeConfig.earlyWithdrawFeeBps;
        }

        return feeConfig.withdrawFeeBps;
    }

    function _toUsd18(
        address token,
        uint256 tokenAmount,
        uint256 priceUsd
    ) internal view returns (uint256) {
        TokenConfig memory cfg = tokenConfigs[token];

        uint8 priceDecimals = oracle.PRICE_DECIMALS();
        uint256 priceScale = 10 ** uint256(18 - priceDecimals);
        uint256 tokenScale = 10 ** uint256(cfg.decimals);

        return (tokenAmount * priceUsd * priceScale) / tokenScale;
    }

    function _safeTransferFrom(
        address token,
        address from,
        address to,
        uint256 amount
    ) internal {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20Minimal.transferFrom.selector, from, to, amount)
        );

        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert TransferFailed();
        }
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20Minimal.transfer.selector, to, amount)
        );

        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert TransferFailed();
        }
    }
}
