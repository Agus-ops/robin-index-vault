// Sources flattened with hardhat v2.28.6 https://hardhat.org

// SPDX-License-Identifier: MIT

// File contracts/FeeTreasury.sol

// Original license: SPDX_License_Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Treasury {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

/**
 * @title FeeTreasury
 * @notice Receives protocol fees from allowed sources and splits them atomically
 *         into Reserve / Rewards / Router / Operator buckets.
 */
contract FeeTreasury {
    uint256 public constant BPS = 10_000;

    uint8 public constant BUCKET_RESERVE = 0;
    uint8 public constant BUCKET_REWARDS = 1;
    uint8 public constant BUCKET_ROUTER = 2;
    uint8 public constant BUCKET_OPERATOR = 3;

    struct SplitConfig {
        uint16 reserveBps;
        uint16 rewardsBps;
        uint16 routerBps;
        uint16 operatorBps;
    }

    struct TokenBuckets {
        uint256 reserveAmount;
        uint256 rewardsAmount;
        uint256 routerAmount;
        uint256 operatorAmount;
        uint256 totalReceived;
        uint256 totalWithdrawn;
    }

    address public owner;
    bool public paused;

    SplitConfig public splitConfig;

    mapping(address => bool) public keepers;
    mapping(address => bool) public pausers;
    mapping(address => bool) public allowedFeeSources;

    mapping(address => TokenBuckets) private _buckets;
    mapping(address => uint256) public distributionThreshold;

    address public rewardDistributor;

    error NotOwner();
    error NotKeeper();
    error NotPauser();
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

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event KeeperUpdated(address indexed keeper, bool allowed);
    event PauserUpdated(address indexed pauser, bool allowed);
    event FeeSourceUpdated(address indexed source, bool allowed);
    event RewardDistributorUpdated(address indexed oldDistributor, address indexed newDistributor);

    event FeeReceived(address indexed token, address indexed source, uint256 amount);

    event FeeSplit(
        address indexed token,
        uint256 reserveAmount,
        uint256 rewardsAmount,
        uint256 routerAmount,
        uint256 operatorAmount
    );

    event SplitConfigUpdated(
        uint16 reserveBps,
        uint16 rewardsBps,
        uint16 routerBps,
        uint16 operatorBps
    );

    event DistributionThresholdUpdated(
        address indexed token,
        uint256 oldThreshold,
        uint256 newThreshold
    );

    event BucketWithdrawn(
        address indexed token,
        address indexed to,
        uint8 indexed bucket,
        uint256 amount
    );

    event UnaccountedTokenRecovered(address indexed token, address indexed to, uint256 amount);
    event PausedStateUpdated(bool paused, address indexed account);

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

    modifier onlyFeeSource() {
        if (!allowedFeeSources[msg.sender]) revert NotFeeSource();
        _;
    }

    constructor(address initialOwner) {
        address resolvedOwner = initialOwner == address(0) ? msg.sender : initialOwner;

        owner = resolvedOwner;

        splitConfig = SplitConfig({
            reserveBps: 5000,
            rewardsBps: 3000,
            routerBps: 1500,
            operatorBps: 500
        });

        emit OwnershipTransferred(address(0), resolvedOwner);
        emit SplitConfigUpdated(5000, 3000, 1500, 500);
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

    function setSplitConfig(
        uint16 reserveBps,
        uint16 rewardsBps,
        uint16 routerBps,
        uint16 operatorBps
    ) external onlyOwner {
        uint256 total = uint256(reserveBps)
            + uint256(rewardsBps)
            + uint256(routerBps)
            + uint256(operatorBps);

        if (total != BPS) revert InvalidSplit();

        splitConfig = SplitConfig({
            reserveBps: reserveBps,
            rewardsBps: rewardsBps,
            routerBps: routerBps,
            operatorBps: operatorBps
        });

        emit SplitConfigUpdated(reserveBps, rewardsBps, routerBps, operatorBps);
    }

    function setDistributionThreshold(
        address token,
        uint256 threshold
    ) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();

        uint256 oldThreshold = distributionThreshold[token];
        distributionThreshold[token] = threshold;

        emit DistributionThresholdUpdated(token, oldThreshold, threshold);
    }

    /**
     * @notice Records a fee that has already been transferred into this treasury.
     * @dev Caller must be an allowed fee source, e.g. RobinIndexVault or StockRouter.
     */
    function receiveFee(
        address token,
        uint256 amount
    ) external nonReentrant whenNotPaused onlyFeeSource {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();

        uint256 accountedBefore = accountedBalance(token);
        uint256 actualBalance = IERC20Treasury(token).balanceOf(address(this));

        if (actualBalance < accountedBefore + amount) {
            revert InsufficientTreasuryBalance();
        }

        SplitConfig memory cfg = splitConfig;

        uint256 reserveAmount = (amount * cfg.reserveBps) / BPS;
        uint256 rewardsAmount = (amount * cfg.rewardsBps) / BPS;
        uint256 routerAmount = (amount * cfg.routerBps) / BPS;
        uint256 operatorAmount = (amount * cfg.operatorBps) / BPS;

        uint256 allocated = reserveAmount
            + rewardsAmount
            + routerAmount
            + operatorAmount;

        // Protocol-first: rounding dust goes to reserve.
        reserveAmount += amount - allocated;

        TokenBuckets storage b = _buckets[token];

        b.reserveAmount += reserveAmount;
        b.rewardsAmount += rewardsAmount;
        b.routerAmount += routerAmount;
        b.operatorAmount += operatorAmount;
        b.totalReceived += amount;

        emit FeeReceived(token, msg.sender, amount);

        emit FeeSplit(
            token,
            reserveAmount,
            rewardsAmount,
            routerAmount,
            operatorAmount
        );
    }

    function withdrawBucket(
        address token,
        uint8 bucket,
        address to,
        uint256 amount
    ) external nonReentrant whenNotPaused onlyKeeperOrOwner {
        if (token == address(0)) revert ZeroAddress();
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();

        TokenBuckets storage b = _buckets[token];

        if (bucket == BUCKET_RESERVE) {
            if (b.reserveAmount < amount) revert InsufficientBucket();
            b.reserveAmount -= amount;
        } else if (bucket == BUCKET_REWARDS) {
            uint256 threshold = distributionThreshold[token];

            if (threshold == 0 || b.rewardsAmount < threshold) {
                revert ThresholdNotMet();
            }

            if (rewardDistributor != address(0) && to != rewardDistributor) {
                revert InvalidRewardRecipient();
            }

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

        _safeTransfer(token, to, amount);

        emit BucketWithdrawn(token, to, bucket, amount);
    }

    function recoverUnaccountedToken(
        address token,
        address to,
        uint256 amount
    ) external nonReentrant onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();

        uint256 actualBalance = IERC20Treasury(token).balanceOf(address(this));
        uint256 accounted = accountedBalance(token);

        if (actualBalance < accounted + amount) {
            revert InsufficientTreasuryBalance();
        }

        _safeTransfer(token, to, amount);

        emit UnaccountedTokenRecovered(token, to, amount);
    }

    function getBuckets(
        address token
    )
        external
        view
        returns (
            uint256 reserveAmount,
            uint256 rewardsAmount,
            uint256 routerAmount,
            uint256 operatorAmount,
            uint256 totalReceived,
            uint256 totalWithdrawn
        )
    {
        TokenBuckets memory b = _buckets[token];

        return (
            b.reserveAmount,
            b.rewardsAmount,
            b.routerAmount,
            b.operatorAmount,
            b.totalReceived,
            b.totalWithdrawn
        );
    }

    function accountedBalance(address token) public view returns (uint256) {
        TokenBuckets memory b = _buckets[token];

        return b.reserveAmount
            + b.rewardsAmount
            + b.routerAmount
            + b.operatorAmount;
    }

    function canDistribute(address token) external view returns (bool) {
        uint256 threshold = distributionThreshold[token];

        if (threshold == 0) return false;

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

    function isKeeper(address account) external view returns (bool) {
        return keepers[account];
    }

    function isPauser(address account) external view returns (bool) {
        return pausers[account];
    }

    function isFeeSource(address account) external view returns (bool) {
        return allowedFeeSources[account];
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20Treasury.transfer.selector, to, amount)
        );

        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert TransferFailed();
        }
    }
}
