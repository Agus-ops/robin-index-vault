// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

// ============================================================
// FeeTreasury v0.8.1 — Minor Fixes from Audit
// ============================================================
// Fixes applied:
//   1. threshold = 0 now means "no minimum" (allow withdrawal anytime)
//   2. rewardDistributor must be set before rewards can be withdrawn
//   3. Added error InvalidRewardDistributor for clarity
//   4. Rest unchanged — split 50/30/15/5, receiveFee, withdrawBucket, recover all solid
// ============================================================

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract FeeTreasury is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint8 public constant BUCKET_RESERVE = 0;
    uint8 public constant BUCKET_REWARDS = 1;
    uint8 public constant BUCKET_ROUTER = 2;
    uint8 public constant BUCKET_OPERATOR = 3;

    struct SplitConfig {
        uint16 reserveBps;   // 5000 = 50%
        uint16 rewardsBps;   // 3000 = 30%
        uint16 routerBps;    // 1500 = 15%
        uint16 operatorBps;  // 500 = 5%
    }

    struct TokenBuckets {
        uint256 reserveAmount;
        uint256 rewardsAmount;
        uint256 routerAmount;
        uint256 operatorAmount;
        uint256 totalReceived;
        uint256 totalWithdrawn;
    }

    bool public paused;
    SplitConfig public splitConfig;
    mapping(address => bool) public keepers;
    mapping(address => bool) public pausers;
    mapping(address => bool) public allowedFeeSources;
    mapping(address => TokenBuckets) private _buckets;
    mapping(address => uint256) public distributionThreshold;
    address public rewardDistributor;

    // ============================================================
    // Errors
    // ============================================================
    error NotOwner();
    error NotKeeper();
    error NotPauser();
    error NotAuthorized();
    error ZeroAddress();
    error InvalidAmount();
    error InvalidSplit();
    error InvalidBucket();
    error NotFeeSource();
    error Paused();
    error InsufficientBucket();
    error ThresholdNotMet();
    error InsufficientTreasuryBalance();
    error TransferFailed();
    error InvalidRewardRecipient();
    error InvalidRewardDistributor();

    // ============================================================
    // Events
    // ============================================================
    event KeeperUpdated(address indexed keeper, bool allowed);
    event PauserUpdated(address indexed pauser, bool allowed);
    event FeeSourceUpdated(address indexed source, bool allowed);
    event RewardDistributorUpdated(address indexed oldDistributor, address indexed newDistributor);
    event FeeReceived(address indexed token, address indexed source, uint256 amount);
    event FeeSplit(address indexed token, uint256 reserveAmount, uint256 rewardsAmount, uint256 routerAmount, uint256 operatorAmount);
    event SplitConfigUpdated(uint16 reserveBps, uint16 rewardsBps, uint16 routerBps, uint16 operatorBps);
    event DistributionThresholdUpdated(address indexed token, uint256 oldThreshold, uint256 newThreshold);
    event BucketWithdrawn(address indexed token, address indexed to, uint8 indexed bucket, uint256 amount);
    event UnaccountedTokenRecovered(address indexed token, address indexed to, uint256 amount);
    event PausedStateUpdated(bool paused, address indexed account);

    // ============================================================
    // Modifiers
    // ============================================================
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
    modifier onlyFeeSource() {
        if (!allowedFeeSources[msg.sender]) revert NotFeeSource();
        _;
    }

    // ============================================================
    // Constructor
    // ============================================================
    constructor(address initialOwner) Ownable(initialOwner) {
        splitConfig = SplitConfig({reserveBps: 5000, rewardsBps: 3000, routerBps: 1500, operatorBps: 500});
        emit SplitConfigUpdated(5000, 3000, 1500, 500);
    }

    // ============================================================
    // Owner / Roles
    // ============================================================
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
    function setFeeSource(address source, bool allowed) external onlyOwner {
        if (source == address(0)) revert ZeroAddress();
        allowedFeeSources[source] = allowed;
        emit FeeSourceUpdated(source, allowed);
    }
    function setRewardDistributor(address newDistributor) external onlyOwner {
        if (newDistributor == address(0)) revert ZeroAddress();
        address oldDistributor = rewardDistributor;
        rewardDistributor = newDistributor;
        emit RewardDistributorUpdated(oldDistributor, newDistributor);
    }
    function pause() external onlyPauserOrOwner {
        paused = true;
        emit PausedStateUpdated(true, msg.sender);
    }
    function unpause() external onlyOwner {
        paused = false;
        emit PausedStateUpdated(false, msg.sender);
    }

    // ============================================================
    // Config
    // ============================================================
    function setSplitConfig(uint16 reserveBps, uint16 rewardsBps, uint16 routerBps, uint16 operatorBps) external onlyOwner {
        uint256 total = uint256(reserveBps) + uint256(rewardsBps) + uint256(routerBps) + uint256(operatorBps);
        if (total != BPS) revert InvalidSplit();
        splitConfig = SplitConfig({reserveBps: reserveBps, rewardsBps: rewardsBps, routerBps: routerBps, operatorBps: operatorBps});
        emit SplitConfigUpdated(reserveBps, rewardsBps, routerBps, operatorBps);
    }
    function setDistributionThreshold(address token, uint256 threshold) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        uint256 oldThreshold = distributionThreshold[token];
        distributionThreshold[token] = threshold;
        emit DistributionThresholdUpdated(token, oldThreshold, threshold);
    }

    // ============================================================
    // Fee Receive / Split
    // ============================================================
    function receiveFee(address token, uint256 amount) external nonReentrant whenNotPaused onlyFeeSource {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();
        uint256 accountedBefore = accountedBalance(token);
        uint256 actualBalance = IERC20(token).balanceOf(address(this));
        if (actualBalance < accountedBefore + amount) revert InsufficientTreasuryBalance();
        SplitConfig memory cfg = splitConfig;
        uint256 reserveAmount = (amount * cfg.reserveBps) / BPS;
        uint256 rewardsAmount = (amount * cfg.rewardsBps) / BPS;
        uint256 routerAmount = (amount * cfg.routerBps) / BPS;
        uint256 operatorAmount = amount - reserveAmount - rewardsAmount - routerAmount;
        TokenBuckets storage b = _buckets[token];
        b.reserveAmount += reserveAmount;
        b.rewardsAmount += rewardsAmount;
        b.routerAmount += routerAmount;
        b.operatorAmount += operatorAmount;
        b.totalReceived += amount;
        emit FeeReceived(token, msg.sender, amount);
        emit FeeSplit(token, reserveAmount, rewardsAmount, routerAmount, operatorAmount);
    }

    // ============================================================
    // Withdraw Buckets
    // ============================================================
    function withdrawBucket(address token, uint8 bucket, address to, uint256 amount) external nonReentrant whenNotPaused onlyKeeperOrOwner {
        if (token == address(0) || to == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();
        TokenBuckets storage b = _buckets[token];
        if (bucket == BUCKET_RESERVE) {
            if (b.reserveAmount < amount) revert InsufficientBucket();
            b.reserveAmount -= amount;
        } else if (bucket == BUCKET_REWARDS) {
            uint256 threshold = distributionThreshold[token];
            // v0.8.1: threshold = 0 berarti "no minimum" (allow withdrawal anytime)
            if (threshold > 0 && b.rewardsAmount < threshold) revert ThresholdNotMet();
            // v0.8.1: rewardDistributor harus sudah diset sebelum rewards bisa diwithdraw
            if (rewardDistributor == address(0)) revert InvalidRewardDistributor();
            if (to != rewardDistributor) revert InvalidRewardRecipient();
            if (b.rewardsAmount < amount) revert InsufficientBucket();
            b.rewardsAmount -= amount;
        } else if (bucket == BUCKET_ROUTER) {
            if (b.routerAmount < amount) revert InsufficientBucket();
            b.routerAmount -= amount;
        } else if (bucket == BUCKET_OPERATOR) {
            if (b.operatorAmount < amount) revert InsufficientBucket();
            b.operatorAmount -= amount;
        } else {
            revert InvalidBucket();
        }
        b.totalWithdrawn += amount;
        IERC20(token).safeTransfer(to, amount);
        emit BucketWithdrawn(token, to, bucket, amount);
    }

    // ============================================================
    // Recovery
    // ============================================================
    function recoverUnaccountedToken(address token, address to, uint256 amount) external nonReentrant onlyOwner {
        if (token == address(0) || to == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();
        uint256 actualBalance = IERC20(token).balanceOf(address(this));
        uint256 accounted = accountedBalance(token);
        if (actualBalance < accounted + amount) revert InsufficientTreasuryBalance();
        IERC20(token).safeTransfer(to, amount);
        emit UnaccountedTokenRecovered(token, to, amount);
    }

    // ============================================================
    // Views
    // ============================================================
    function getBuckets(address token) external view returns (uint256 reserveAmount, uint256 rewardsAmount, uint256 routerAmount, uint256 operatorAmount, uint256 totalReceived, uint256 totalWithdrawn) {
        TokenBuckets memory b = _buckets[token];
        return (b.reserveAmount, b.rewardsAmount, b.routerAmount, b.operatorAmount, b.totalReceived, b.totalWithdrawn);
    }
    function accountedBalance(address token) public view returns (uint256) {
        TokenBuckets memory b = _buckets[token];
        return b.reserveAmount + b.rewardsAmount + b.routerAmount + b.operatorAmount;
    }
    function canDistribute(address token) external view returns (bool) {
        uint256 threshold = distributionThreshold[token];
        if (threshold == 0) return true; // v0.8.1: threshold = 0 berarti "no minimum"
        return _buckets[token].rewardsAmount >= threshold;
    }
    function bucketBalance(address token, uint8 bucket) external view returns (uint256) {
        TokenBuckets memory b = _buckets[token];
        if (bucket == BUCKET_RESERVE) return b.reserveAmount;
        if (bucket == BUCKET_REWARDS) return b.rewardsAmount;
        if (bucket == BUCKET_ROUTER) return b.routerAmount;
        if (bucket == BUCKET_OPERATOR) return b.operatorAmount;
        revert InvalidBucket();
    }
}
