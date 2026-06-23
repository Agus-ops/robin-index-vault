// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

interface IStockOracle {
    function getPrice(address token) external view returns (uint256);
    function isFresh(address token) external view returns (bool);
}

contract StockRouter is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant MAX_FEE_BPS = 500;

    IStockOracle public oracle;
    address public treasury;
    mapping(address => bool) public keepers;
    bool public paused;

    struct TokenConfig {
        bool supported;
        uint8 decimals;
        uint256 maxSingleSwap;
        uint256 dailyCap;
        uint256 minInventory;
        uint256 lowInventoryAlert;
    }
    mapping(address => TokenConfig) public tokenConfig;

    uint16 public swapFeeBps = 100;
    uint256 public cooldown = 10 minutes;
    uint256 public perPairDailyCap = 2e18;

    mapping(address => mapping(uint256 => uint256)) public userDailyVolume;
    mapping(bytes32 => mapping(uint256 => uint256)) public pairDailyVolume;
    mapping(address => uint256) public lastSwapAt;
    mapping(address => bool) public lowAlertTriggered;

    event Swapped(address indexed user, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, uint256 fee);
    event InventoryRestocked(address indexed token, uint256 amount);
    event InventoryWithdrawn(address indexed token, uint256 amount);
    event LowInventoryAlert(address indexed token, uint256 remaining);
    event TokenConfigUpdated(address indexed token, bool supported, uint8 decimals, uint256 maxSingleSwap, uint256 dailyCap, uint256 minInventory, uint256 lowInventoryAlert);
    event KeeperUpdated(address indexed keeper, bool enabled);
    event SwapFeeUpdated(uint16 feeBps);
    event CooldownUpdated(uint256 cooldown);
    event PerPairDailyCapUpdated(uint256 cap);
    event OracleUpdated(address indexed oldOracle, address indexed newOracle);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    event EmergencyRecovered(address indexed token, address indexed to, uint256 amount);

    modifier onlyKeeperOrOwner() {
        require(msg.sender == owner() || keepers[msg.sender], "!keeper");
        _;
    }
    modifier whenNotPaused() {
        require(!paused, "paused");
        _;
    }

    constructor(address _oracle, address _treasury) Ownable(msg.sender) {
        require(_oracle != address(0) && _treasury != address(0), "zero address");
        require(_oracle.code.length > 0, "oracle not contract");
        oracle = IStockOracle(_oracle);
        treasury = _treasury;
        keepers[msg.sender] = true;
    }

    function setTokenConfig(address token, bool supported, uint8 decimals_, uint256 maxSingleSwap_, uint256 dailyCap_, uint256 minInventory_, uint256 lowInventoryAlert_) external onlyOwner {
        if (supported) {
            require(decimals_ <= 18, "decimals > 18");
            require(maxSingleSwap_ > 0 && dailyCap_ > 0 && minInventory_ > 0, "invalid config");
            require(lowInventoryAlert_ > minInventory_, "alert must be > minInventory");
        }
        tokenConfig[token] = TokenConfig(supported, decimals_, maxSingleSwap_, dailyCap_, minInventory_, lowInventoryAlert_);
        emit TokenConfigUpdated(token, supported, decimals_, maxSingleSwap_, dailyCap_, minInventory_, lowInventoryAlert_);
    }

    function setSwapFeeBps(uint16 _fee) external onlyOwner {
        require(_fee <= MAX_FEE_BPS, "fee too high");
        swapFeeBps = _fee;
        emit SwapFeeUpdated(_fee);
    }

    function setCooldown(uint256 _cooldown) external onlyOwner {
        cooldown = _cooldown;
        emit CooldownUpdated(_cooldown);
    }

    function setPerPairDailyCap(uint256 _cap) external onlyOwner {
        perPairDailyCap = _cap;
        emit PerPairDailyCapUpdated(_cap);
    }

    function setKeeper(address keeper, bool enabled) external onlyOwner {
        keepers[keeper] = enabled;
        emit KeeperUpdated(keeper, enabled);
    }

    function setOracle(address _oracle) external onlyOwner {
        require(_oracle != address(0), "zero address");
        require(_oracle.code.length > 0, "not contract");
        emit OracleUpdated(address(oracle), _oracle);
        oracle = IStockOracle(_oracle);
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "zero address");
        emit TreasuryUpdated(treasury, _treasury);
        treasury = _treasury;
    }

    function restockInventory(address token, uint256 amount) external onlyKeeperOrOwner {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        TokenConfig memory cfg = tokenConfig[token];
        if (IERC20(token).balanceOf(address(this)) >= cfg.lowInventoryAlert) {
            lowAlertTriggered[token] = false;
        }
        emit InventoryRestocked(token, amount);
    }

    function withdrawInventory(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "zero address");
        TokenConfig memory cfg = tokenConfig[token];
        uint256 inventory = IERC20(token).balanceOf(address(this));
        require(inventory >= amount + cfg.minInventory, "below min inventory");
        IERC20(token).safeTransfer(to, amount);
        emit InventoryWithdrawn(token, amount);
    }

    function emergencyRecover(address token, address to) external onlyOwner {
        require(to != address(0), "zero address");
        TokenConfig memory cfg = tokenConfig[token];
        require(!cfg.supported, "supported token");
        uint256 bal = IERC20(token).balanceOf(address(this));
        require(bal > 0, "zero balance");
        IERC20(token).safeTransfer(to, bal);
        emit EmergencyRecovered(token, to, bal);
    }

    function pause() external onlyKeeperOrOwner {
        require(!paused, "already paused");
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        require(paused, "already unpaused");
        paused = false;
        emit Unpaused(msg.sender);
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut)
        external nonReentrant whenNotPaused
    {
        TokenConfig memory cfgIn = tokenConfig[tokenIn];
        TokenConfig memory cfgOut = tokenConfig[tokenOut];
        require(cfgIn.supported && cfgOut.supported, "unsupported");
        require(tokenIn != tokenOut, "same token");

        require(block.timestamp >= lastSwapAt[msg.sender] + cooldown, "cooldown");

        require(oracle.isFresh(tokenIn) && oracle.isFresh(tokenOut), "stale");
        uint256 priceIn = oracle.getPrice(tokenIn);
        uint256 priceOut = oracle.getPrice(tokenOut);
        require(priceIn > 0 && priceOut > 0, "price=0");

        uint256 balBefore = IERC20(tokenIn).balanceOf(address(this));
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        uint256 received = IERC20(tokenIn).balanceOf(address(this)) - balBefore;
        require(received > 0, "zero received");

        uint256 day = block.timestamp / 1 days;
        uint256 normalizedReceived = received * (10 ** (18 - cfgIn.decimals));
        uint256 normalizedCap = cfgIn.dailyCap * (10 ** (18 - cfgIn.decimals));
        
        uint256 userVol = userDailyVolume[msg.sender][day];
        require(userVol + normalizedReceived <= normalizedCap, "user daily cap");
        
        bytes32 pairKey = keccak256(abi.encode(tokenIn, tokenOut));
        uint256 pairVol = pairDailyVolume[pairKey][day];
        require(pairVol + normalizedReceived <= perPairDailyCap, "pair daily cap");
        
        require(received <= cfgIn.maxSingleSwap, "max single swap");

        uint256 amountOut = Math.mulDiv(received, priceIn, priceOut);
        if (cfgIn.decimals > cfgOut.decimals) {
            amountOut /= (10 ** (cfgIn.decimals - cfgOut.decimals));
        } else if (cfgIn.decimals < cfgOut.decimals) {
            amountOut *= (10 ** (cfgOut.decimals - cfgIn.decimals));
        }

        uint256 fee = (amountOut * swapFeeBps) / 10000;
        uint256 amountOutAfterFee = amountOut - fee;
        require(amountOutAfterFee >= minAmountOut, "slippage");

        uint256 inventoryOut = IERC20(tokenOut).balanceOf(address(this));
        require(inventoryOut >= amountOut + cfgOut.minInventory, "low inventory");
        
        uint256 remainingInventory = inventoryOut - amountOut;
        if (remainingInventory < cfgOut.lowInventoryAlert) {
            if (!lowAlertTriggered[tokenOut]) {
                lowAlertTriggered[tokenOut] = true;
                emit LowInventoryAlert(tokenOut, remainingInventory);
            }
        } else {
            lowAlertTriggered[tokenOut] = false;
        }

        userDailyVolume[msg.sender][day] = userVol + normalizedReceived;
        pairDailyVolume[pairKey][day] = pairVol + normalizedReceived;
        lastSwapAt[msg.sender] = block.timestamp;

        IERC20(tokenOut).safeTransfer(msg.sender, amountOutAfterFee);
        if (fee > 0) {
            IERC20(tokenOut).safeTransfer(treasury, fee);
        }

        emit Swapped(msg.sender, tokenIn, tokenOut, received, amountOutAfterFee, fee);
    }
}
