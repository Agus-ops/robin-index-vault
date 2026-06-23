// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

// ============================================================
// MockStockOracle v0.8.1 — Multisig Keeper (Post-Audit Fix)
// ============================================================
// Fixes applied from GPT, Perplexity, Gemini, Qwen audits:
//   1. Epoch-based approvals (ghost approvals fix)
//   2. Validate requiredSignatures <= keeperCount
//   3. Explicit AlreadyApproved error (silent return fix)
//   4. KeeperCount tracking
//   5. Custom error for InvalidRequiredSignatures
//   6. Owner bypass retained as documented
// ============================================================

contract MockStockOracle {
    uint8 public constant PRICE_DECIMALS = 8;
    uint256 public constant DEFAULT_MAX_STALE_TIME = 24 hours;
    uint256 public constant MAX_ALLOWED_STALE_TIME = 7 days;

    address public owner;
    uint256 public maxStaleTime;

    // === MULTISIG KEEPER ===
    mapping(address => bool) public keepers;
    uint256 public keeperCount;
    uint256 public keeperEpoch;
    uint256 public requiredSignatures;  // minimal 2 dari total keeper

    // Epoch-based approvals:
    // token => price => epoch => keeper => approved
    mapping(address => mapping(uint256 => mapping(uint256 => mapping(address => bool)))) public priceApprovals;
    // token => price => epoch => count
    mapping(address => mapping(uint256 => mapping(uint256 => uint256))) public priceApprovalCount;

    // === PRICE DATA ===
    struct PriceData {
        uint256 priceUsd;      // 8 decimals
        uint256 updatedAt;     // unix timestamp
        bool supported;
    }
    mapping(address => PriceData) private _priceData;

    // === ERRORS ===
    error NotOwner();
    error NotKeeper();
    error ZeroAddress();
    error InvalidPrice();
    error UnsupportedToken();
    error NoPrice();
    error LengthMismatch();
    error InvalidStaleTime();
    error InvalidRequiredSignatures();
    error AlreadyApproved();

    // === EVENTS ===
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event KeeperUpdated(address indexed keeper, bool allowed, uint256 keeperCount, uint256 epoch);
    event RequiredSignaturesUpdated(uint256 oldValue, uint256 newValue);
    event PriceUpdated(address indexed token, uint256 priceUsd, uint256 updatedAt);
    event PriceApproved(address indexed token, uint256 priceUsd, address indexed keeper);
    event PriceSetByMultisig(address indexed token, uint256 priceUsd);
    event MaxStaleTimeUpdated(uint256 oldMaxStaleTime, uint256 newMaxStaleTime);
    event SupportedTokenUpdated(address indexed token, bool supported);

    // === MODIFIERS ===
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // === CONSTRUCTOR ===
    constructor(address initialOwner, uint256 initialMaxStaleTime, uint256 _requiredSignatures) {
        address resolvedOwner = initialOwner == address(0) ? msg.sender : initialOwner;
        uint256 resolvedStaleTime = initialMaxStaleTime == 0 ? DEFAULT_MAX_STALE_TIME : initialMaxStaleTime;
        if (resolvedStaleTime == 0 || resolvedStaleTime > MAX_ALLOWED_STALE_TIME) revert InvalidStaleTime();

        owner = resolvedOwner;
        maxStaleTime = resolvedStaleTime;
        requiredSignatures = _requiredSignatures > 0 ? _requiredSignatures : 1;

        emit OwnershipTransferred(address(0), resolvedOwner);
        emit MaxStaleTimeUpdated(0, resolvedStaleTime);
        emit RequiredSignaturesUpdated(0, requiredSignatures);
    }

    // === OWNERSHIP ===
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    // === KEEPER MANAGEMENT ===
    function setKeeper(address keeper, bool allowed) external onlyOwner {
        if (keeper == address(0)) revert ZeroAddress();
        bool wasKeeper = keepers[keeper];
        if (wasKeeper == allowed) return;
        
        keepers[keeper] = allowed;
        if (allowed) {
            keeperCount += 1;
        } else {
            keeperCount -= 1;
        }
        keeperEpoch += 1; // invalidate all old approvals
        emit KeeperUpdated(keeper, allowed, keeperCount, keeperEpoch);
    }

    function setRequiredSignatures(uint256 _required) external onlyOwner {
        if (_required == 0 || _required > keeperCount) revert InvalidRequiredSignatures();
        uint256 oldValue = requiredSignatures;
        requiredSignatures = _required;
        emit RequiredSignaturesUpdated(oldValue, _required);
    }

    // === TOKEN MANAGEMENT ===
    function setSupportedToken(address token, bool supported) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        _priceData[token].supported = supported;
        emit SupportedTokenUpdated(token, supported);
    }

    function setMaxStaleTime(uint256 newMaxStaleTime) external onlyOwner {
        if (newMaxStaleTime == 0 || newMaxStaleTime > MAX_ALLOWED_STALE_TIME) revert InvalidStaleTime();
        uint256 oldMaxStaleTime = maxStaleTime;
        maxStaleTime = newMaxStaleTime;
        emit MaxStaleTimeUpdated(oldMaxStaleTime, newMaxStaleTime);
    }

    // === PRICE UPDATE (MULTISIG) ===
    /// @notice Keeper menyetujui harga tertentu untuk token.
    ///         Jika jumlah approval mencapai requiredSignatures, harga diterapkan.
    function approvePrice(address token, uint256 priceUsd) external {
        if (!keepers[msg.sender]) revert NotKeeper();
        if (token == address(0)) revert ZeroAddress();
        if (!_priceData[token].supported) revert UnsupportedToken();
        if (priceUsd == 0) revert InvalidPrice();

        uint256 epoch = keeperEpoch;
        if (priceApprovals[token][priceUsd][epoch][msg.sender]) revert AlreadyApproved();

        priceApprovals[token][priceUsd][epoch][msg.sender] = true;
        priceApprovalCount[token][priceUsd][epoch] += 1;
        emit PriceApproved(token, priceUsd, msg.sender);

        if (priceApprovalCount[token][priceUsd][epoch] >= requiredSignatures) {
            _priceData[token].priceUsd = priceUsd;
            _priceData[token].updatedAt = block.timestamp;
            emit PriceUpdated(token, priceUsd, block.timestamp);
            emit PriceSetByMultisig(token, priceUsd);
        }
    }

    /// @notice Owner bisa langsung set harga tanpa multisig (backward compatibility)
    function setPrice(address token, uint256 priceUsd) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        if (!_priceData[token].supported) revert UnsupportedToken();
        if (priceUsd == 0) revert InvalidPrice();

        _priceData[token].priceUsd = priceUsd;
        _priceData[token].updatedAt = block.timestamp;
        emit PriceUpdated(token, priceUsd, block.timestamp);
    }

    function setPrices(address[] calldata tokens, uint256[] calldata pricesUsd) external onlyOwner {
        if (tokens.length != pricesUsd.length) revert LengthMismatch();
        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i] == address(0)) revert ZeroAddress();
            if (!_priceData[tokens[i]].supported) revert UnsupportedToken();
            if (pricesUsd[i] == 0) revert InvalidPrice();
            _priceData[tokens[i]].priceUsd = pricesUsd[i];
            _priceData[tokens[i]].updatedAt = block.timestamp;
            emit PriceUpdated(tokens[i], pricesUsd[i], block.timestamp);
        }
    }

    // === VIEW FUNCTIONS ===
    function getPrice(address token) external view returns (uint256 priceUsd) {
        PriceData memory data = _priceData[token];
        if (!data.supported) revert UnsupportedToken();
        if (data.priceUsd == 0) revert NoPrice();
        return data.priceUsd;
    }

    function getPriceData(address token) external view returns (uint256 priceUsd, uint256 updatedAt, bool supported) {
        PriceData memory data = _priceData[token];
        return (data.priceUsd, data.updatedAt, data.supported);
    }

    function lastUpdated(address token) external view returns (uint256) {
        return _priceData[token].updatedAt;
    }

    function isFresh(address token) public view returns (bool) {
        PriceData memory data = _priceData[token];
        if (!data.supported) return false;
        if (data.priceUsd == 0) return false;
        if (data.updatedAt == 0) return false;
        return block.timestamp <= data.updatedAt + maxStaleTime;
    }

    function isSupported(address token) external view returns (bool) {
        return _priceData[token].supported;
    }

    function getFreshPrice(address token) external view returns (uint256 priceUsd) {
        PriceData memory data = _priceData[token];
        if (!data.supported) revert UnsupportedToken();
        if (data.priceUsd == 0) revert NoPrice();
        if (block.timestamp > data.updatedAt + maxStaleTime) revert NoPrice();
        return data.priceUsd;
    }
}
