// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

// ============================================================
// RewardDistributor v0.8.1 — Merkle Distributor (Post-Audit Fix)
// ============================================================
// Fixes applied:
//   1. transferOwnership: public override (compilation fix)
//   2. Removed double OwnershipTransferred event emission
//   3. setMerkleRoot: root overwrite protection (RootAlreadyClaimed)
//   4. claim(): amount > 0 check
//   5. Removed custom reentrancy guard, use OZ nonReentrant
//   6. Leaf construction: added week to prevent cross-week collision
//   7. Removed on-chain cap check (cap enforced off-chain during tree generation)
// ============================================================

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

contract RewardDistributor is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint256 public constant WEEK = 7 days;

    address public immutable feeTreasury;
    bool public paused;

    mapping(address => bool) public keepers;

    struct TokenConfig {
        bool enabled;
        uint256 absoluteWeeklyCap;
    }

    mapping(address => TokenConfig) public tokenConfig;

    mapping(address => mapping(uint256 => bytes32)) public merkleRoots;

    mapping(address => uint256) public tokenTotalFunded;
    mapping(address => uint256) public tokenTotalClaimed;
    mapping(address => mapping(uint256 => uint256)) public weekFunded;
    mapping(address => mapping(uint256 => uint256)) public weekClaimedTotal;
    mapping(address => mapping(address => mapping(uint256 => bool))) public claimed;

    // ============================================================
    // Errors
    // ============================================================
    error ZeroAddress();
    error InvalidAmount();
    error Unauthorized();
    error Paused();
    error TokenDisabled();
    error InvalidWeek();
    error InsufficientUnallocatedBalance();
    error NothingToClaim();
    error WeekPoolExceeded();
    error TransferFailed();
    error AlreadyClaimed();
    error InvalidProof();
    error RootAlreadyClaimed();

    // ============================================================
    // Events
    // ============================================================
    event KeeperUpdated(address indexed keeper, bool allowed);
    event PausedStateUpdated(bool paused, address indexed caller);
    event TokenConfigUpdated(address indexed token, bool enabled, uint256 absoluteWeeklyCap);
    event RewardsFunded(address indexed token, uint256 indexed week, uint256 amount);
    event MerkleRootSet(address indexed token, uint256 indexed week, bytes32 root);
    event RewardClaimed(address indexed user, address indexed token, uint256 indexed week, uint256 amount);

    // ============================================================
    // Modifiers
    // ============================================================
    modifier onlyKeeperOrOwner() {
        if (msg.sender != owner() && !keepers[msg.sender]) revert Unauthorized();
        _;
    }
    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    // ============================================================
    // Constructor
    // ============================================================
    constructor(address treasury_) Ownable(msg.sender) {
        if (treasury_ == address(0)) revert ZeroAddress();
        feeTreasury = treasury_;
        keepers[msg.sender] = true;
        emit KeeperUpdated(msg.sender, true);
    }

    // ============================================================
    // Owner / Keeper Management
    // ============================================================
    function transferOwnership(address newOwner) public override onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address oldOwner = owner();
        _transferOwnership(newOwner);
        if (oldOwner != newOwner && keepers[oldOwner]) {
            keepers[oldOwner] = false;
            emit KeeperUpdated(oldOwner, false);
        }
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

    // ============================================================
    // Token Configuration
    // ============================================================
    function currentWeek() public view returns (uint256) {
        return block.timestamp / WEEK;
    }

    function setTokenConfig(address token, bool enabled, uint256 absoluteWeeklyCap) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        if (enabled && absoluteWeeklyCap == 0) revert InvalidAmount();
        tokenConfig[token] = TokenConfig({enabled: enabled, absoluteWeeklyCap: absoluteWeeklyCap});
        emit TokenConfigUpdated(token, enabled, absoluteWeeklyCap);
    }

    // ============================================================
    // Available Balance
    // ============================================================
    function availableUnallocated(address token) public view returns (uint256) {
        if (token == address(0)) revert ZeroAddress();
        uint256 bal = IERC20(token).balanceOf(address(this));
        uint256 obligated = tokenTotalFunded[token] - tokenTotalClaimed[token];
        if (bal <= obligated) return 0;
        return bal - obligated;
    }

    // ============================================================
    // Fund Week
    // ============================================================
    function fundWeek(address token, uint256 week, uint256 amount) external onlyKeeperOrOwner whenNotPaused {
        if (!tokenConfig[token].enabled) revert TokenDisabled();
        if (amount == 0) revert InvalidAmount();
        if (week > currentWeek()) revert InvalidWeek();
        if (availableUnallocated(token) < amount) revert InsufficientUnallocatedBalance();

        weekFunded[token][week] += amount;
        tokenTotalFunded[token] += amount;
        emit RewardsFunded(token, week, amount);
    }

    // ============================================================
    // Set Merkle Root
    // ============================================================
    function setMerkleRoot(address token, uint256 week, bytes32 root) external onlyKeeperOrOwner {
        if (!tokenConfig[token].enabled) revert TokenDisabled();
        if (week > currentWeek()) revert InvalidWeek();

        bytes32 existingRoot = merkleRoots[token][week];
        if (existingRoot != bytes32(0) && weekClaimedTotal[token][week] > 0) {
            revert RootAlreadyClaimed();
        }

        merkleRoots[token][week] = root;
        emit MerkleRootSet(token, week, root);
    }

    // ============================================================
    // Claim Reward dengan Merkle Proof
    // ============================================================
    function claim(
        address token,
        uint256 week,
        uint256 amount,
        bytes32[] calldata proof
    ) external whenNotPaused nonReentrant {
        if (!tokenConfig[token].enabled) revert TokenDisabled();
        if (week > currentWeek()) revert InvalidWeek();
        if (amount == 0) revert InvalidAmount();

        // 1. Cegah double claim
        if (claimed[msg.sender][token][week]) revert AlreadyClaimed();

        // 2. Verifikasi Merkle proof (leaf includes week)
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender, token, week, amount))));
        if (!MerkleProof.verify(proof, merkleRoots[token][week], leaf)) revert InvalidProof();

        // 3. Cek pool
        uint256 newWeekClaimed = weekClaimedTotal[token][week] + amount;
        if (newWeekClaimed > weekFunded[token][week]) revert WeekPoolExceeded();

        // 4. Catat claimed
        claimed[msg.sender][token][week] = true;
        weekClaimedTotal[token][week] = newWeekClaimed;
        tokenTotalClaimed[token] += amount;

        // 5. Transfer reward ke user
        IERC20(token).safeTransfer(msg.sender, amount);

        emit RewardClaimed(msg.sender, token, week, amount);
    }
}
