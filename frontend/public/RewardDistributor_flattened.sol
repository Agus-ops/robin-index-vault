// Sources flattened with hardhat v2.28.6 https://hardhat.org

// SPDX-License-Identifier: MIT

// File contracts/RewardDistributor.sol

// Original license: SPDX_License_Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal ERC20 interface used by RewardDistributor.
interface IERC20RewardToken {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title RewardDistributor
/// @notice Keeper-managed, claim-based reward distributor for Robin Index Vault MVP.
/// @dev No minting. Rewards must be transferred from FeeTreasury rewards bucket before funding a week.
contract RewardDistributor {
    uint256 public constant BPS = 10_000;
    uint256 public constant WEEK = 7 days;

    /// @notice Max 5% of weekly funded pool per user.
    uint16 public constant RELATIVE_CAP_BPS = 500;

    address public owner;

    /// @notice Reference treasury address for provenance. This contract does not call treasury withdrawBucket.
    address public immutable feeTreasury;

    bool public paused;
    bool private _entered;

    mapping(address => bool) public keepers;

    struct TokenConfig {
        bool enabled;
        uint256 absoluteWeeklyCap;
    }

    /// token => config
    mapping(address => TokenConfig) public tokenConfig;

    /// token => total amount assigned into weekly reward pools
    mapping(address => uint256) public tokenTotalFunded;

    /// token => total claimed across all weeks
    mapping(address => uint256) public tokenTotalClaimed;

    /// token => week => amount funded from already-received reward balance
    mapping(address => mapping(uint256 => uint256)) public weekFunded;

    /// token => week => total claimed
    mapping(address => mapping(uint256 => uint256)) public weekClaimedTotal;

    /// user => token => week => allocation
    mapping(address => mapping(address => mapping(uint256 => uint256))) public allocation;

    /// user => token => week => claimed
    mapping(address => mapping(address => mapping(uint256 => uint256))) public claimed;

    error ZeroAddress();
    error InvalidAmount();
    error Unauthorized();
    error Paused();
    error Reentrancy();
    error TokenDisabled();
    error InvalidWeek();
    error InsufficientUnallocatedBalance();
    error NothingToClaim();
    error WeekPoolExceeded();
    error TransferFailed();

    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event KeeperUpdated(address indexed keeper, bool allowed);
    event PausedStateUpdated(bool paused, address indexed caller);

    event TokenConfigUpdated(
        address indexed token,
        bool enabled,
        uint256 absoluteWeeklyCap
    );

    event RewardsFunded(
        address indexed token,
        uint256 indexed week,
        uint256 amount
    );

    event AllocationSet(
        address indexed user,
        address indexed token,
        uint256 indexed week,
        uint256 oldAmount,
        uint256 newAmount
    );

    event RewardClaimed(
        address indexed user,
        address indexed token,
        uint256 indexed week,
        uint256 amount
    );

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyKeeperOrOwner() {
        if (msg.sender != owner && !keepers[msg.sender]) revert Unauthorized();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier nonReentrant() {
        if (_entered) revert Reentrancy();
        _entered = true;
        _;
        _entered = false;
    }

    constructor(address treasury_) {
        if (treasury_ == address(0)) revert ZeroAddress();

        owner = msg.sender;
        keepers[msg.sender] = true;
        feeTreasury = treasury_;

        emit OwnershipTransferred(address(0), msg.sender);
        emit KeeperUpdated(msg.sender, true);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();

        address oldOwner = owner;
        owner = newOwner;

        if (oldOwner != newOwner && keepers[oldOwner]) {
            keepers[oldOwner] = false;
            emit KeeperUpdated(oldOwner, false);
        }

        emit OwnershipTransferred(oldOwner, newOwner);
    }

    function setKeeper(address keeper, bool allowed) external onlyOwner {
        if (keeper == address(0)) revert ZeroAddress();

        keepers[keeper] = allowed;

        emit KeeperUpdated(keeper, allowed);
    }

    function pause() external onlyKeeperOrOwner {
        paused = true;

        emit PausedStateUpdated(true, msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;

        emit PausedStateUpdated(false, msg.sender);
    }

    function currentWeek() public view returns (uint256) {
        return block.timestamp / WEEK;
    }

    function setTokenConfig(
        address token,
        bool enabled,
        uint256 absoluteWeeklyCap
    ) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();

        if (enabled && absoluteWeeklyCap == 0) {
            revert InvalidAmount();
        }

        tokenConfig[token] = TokenConfig({
            enabled: enabled,
            absoluteWeeklyCap: absoluteWeeklyCap
        });

        emit TokenConfigUpdated(token, enabled, absoluteWeeklyCap);
    }

    /// @notice Amount of token balance not yet assigned to any weekly pool.
    /// @dev Expected source is FeeTreasury rewards bucket withdrawal to this contract.
    function availableUnallocated(address token) public view returns (uint256) {
        if (token == address(0)) revert ZeroAddress();

        uint256 bal = IERC20RewardToken(token).balanceOf(address(this));
        uint256 obligated = tokenTotalFunded[token] - tokenTotalClaimed[token];

        if (bal <= obligated) {
            return 0;
        }

        return bal - obligated;
    }

    /// @notice Register already-received token balance as this week's reward pool.
    /// @dev Before calling this, FeeTreasury owner/keeper should call:
    ///      withdrawBucket(token, BUCKET_REWARDS, address(this), amount).
    ///      RewardDistributor itself does NOT need FeeTreasury keeper role.
    function fundWeek(
        address token,
        uint256 week,
        uint256 amount
    ) external onlyKeeperOrOwner whenNotPaused {
        _requireTokenEnabled(token);

        if (amount == 0) revert InvalidAmount();

        if (week > currentWeek()) {
            revert InvalidWeek();
        }

        if (availableUnallocated(token) < amount) {
            revert InsufficientUnallocatedBalance();
        }

        weekFunded[token][week] += amount;
        tokenTotalFunded[token] += amount;

        emit RewardsFunded(token, week, amount);
    }

    function setAllocation(
        address user,
        address token,
        uint256 week,
        uint256 amount
    ) external onlyKeeperOrOwner {
        _requireUser(user);
        _requireTokenEnabled(token);

        if (week > currentWeek()) {
            revert InvalidWeek();
        }

        uint256 oldAmount = allocation[user][token][week];
        allocation[user][token][week] = amount;

        emit AllocationSet(user, token, week, oldAmount, amount);
    }

    function setAllocations(
        address[] calldata users,
        address token,
        uint256 week,
        uint256[] calldata amounts
    ) external onlyKeeperOrOwner {
        _requireTokenEnabled(token);

        if (week > currentWeek()) {
            revert InvalidWeek();
        }

        if (users.length != amounts.length) {
            revert InvalidAmount();
        }

        for (uint256 i = 0; i < users.length; i++) {
            _requireUser(users[i]);

            uint256 oldAmount = allocation[users[i]][token][week];
            allocation[users[i]][token][week] = amounts[i];

            emit AllocationSet(users[i], token, week, oldAmount, amounts[i]);
        }
    }

    function maxClaimPerUser(
        address token,
        uint256 week
    ) public view returns (uint256) {
        TokenConfig memory cfg = tokenConfig[token];

        if (!cfg.enabled) {
            return 0;
        }

        uint256 relativeCap = (weekFunded[token][week] * RELATIVE_CAP_BPS) / BPS;

        if (relativeCap < cfg.absoluteWeeklyCap) {
            return relativeCap;
        }

        return cfg.absoluteWeeklyCap;
    }

    function claimable(
        address user,
        address token,
        uint256 week
    ) public view returns (uint256) {
        TokenConfig memory cfg = tokenConfig[token];

        if (user == address(0) || !cfg.enabled) {
            return 0;
        }

        uint256 allowed = allocation[user][token][week];
        uint256 cap = maxClaimPerUser(token, week);

        if (allowed > cap) {
            allowed = cap;
        }

        uint256 alreadyClaimed = claimed[user][token][week];

        if (allowed <= alreadyClaimed) {
            return 0;
        }

        return allowed - alreadyClaimed;
    }

    function claim(
        address token,
        uint256 week
    ) external whenNotPaused nonReentrant {
        _requireTokenEnabled(token);

        if (week > currentWeek()) {
            revert InvalidWeek();
        }

        uint256 amount = claimable(msg.sender, token, week);

        if (amount == 0) {
            revert NothingToClaim();
        }

        uint256 newWeekClaimedTotal = weekClaimedTotal[token][week] + amount;

        if (newWeekClaimedTotal > weekFunded[token][week]) {
            revert WeekPoolExceeded();
        }

        claimed[msg.sender][token][week] += amount;
        weekClaimedTotal[token][week] = newWeekClaimedTotal;
        tokenTotalClaimed[token] += amount;

        _safeTransfer(token, msg.sender, amount);

        emit RewardClaimed(msg.sender, token, week, amount);
    }

    function _requireUser(address user) internal pure {
        if (user == address(0)) revert ZeroAddress();
    }

    function _requireTokenEnabled(address token) internal view {
        if (token == address(0)) revert ZeroAddress();

        if (!tokenConfig[token].enabled) {
            revert TokenDisabled();
        }
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20RewardToken.transfer.selector, to, amount)
        );

        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert TransferFailed();
        }
    }
}
