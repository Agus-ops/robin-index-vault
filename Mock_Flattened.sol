// Sources flattened with hardhat v2.28.6 https://hardhat.org

// SPDX-License-Identifier: MIT

// File contracts/interfaces/IStockOracle.sol

// Original license: SPDX_License_Identifier: MIT
pragma solidity ^0.8.24;

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


// File contracts/MockStockOracle.sol

// Original license: SPDX_License_Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MockStockOracle
 * @notice Testnet stock-token price oracle for Robinhood Chain Testnet.
 */
contract MockStockOracle is IStockOracle {
    uint8 public constant override PRICE_DECIMALS = 8;

    uint256 public constant DEFAULT_MAX_STALE_TIME = 24 hours;
    uint256 public constant MAX_ALLOWED_STALE_TIME = 7 days;

    address public owner;
    uint256 public override maxStaleTime;

    mapping(address => PriceData) private _priceData;
    mapping(address => bool) public keepers;

    error NotOwner();
    error NotAuthorized();
    error ZeroAddress();
    error InvalidPrice();
    error UnsupportedToken();
    error NoPrice();
    error StalePrice();
    error LengthMismatch();
    error InvalidStaleTime();

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event SupportedTokenUpdated(address indexed token, bool supported);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyUpdater() {
        if (msg.sender != owner && !keepers[msg.sender]) revert NotAuthorized();
        _;
    }

    constructor(address initialOwner, uint256 initialMaxStaleTime) {
        address resolvedOwner = initialOwner == address(0) ? msg.sender : initialOwner;

        uint256 resolvedStaleTime = initialMaxStaleTime == 0
            ? DEFAULT_MAX_STALE_TIME
            : initialMaxStaleTime;

        if (resolvedStaleTime == 0 || resolvedStaleTime > MAX_ALLOWED_STALE_TIME) {
            revert InvalidStaleTime();
        }

        owner = resolvedOwner;
        maxStaleTime = resolvedStaleTime;

        emit OwnershipTransferred(address(0), resolvedOwner);
        emit MaxStaleTimeUpdated(0, resolvedStaleTime);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();

        address oldOwner = owner;
        owner = newOwner;

        emit OwnershipTransferred(oldOwner, newOwner);
    }

    function setKeeper(address keeper, bool allowed) external override onlyOwner {
        if (keeper == address(0)) revert ZeroAddress();

        keepers[keeper] = allowed;

        emit KeeperUpdated(keeper, allowed);
    }

    function setSupportedToken(address token, bool supported) external override onlyOwner {
        if (token == address(0)) revert ZeroAddress();

        _priceData[token].supported = supported;

        emit SupportedTokenUpdated(token, supported);
    }

    function setMaxStaleTime(uint256 newMaxStaleTime) external override onlyOwner {
        if (newMaxStaleTime == 0 || newMaxStaleTime > MAX_ALLOWED_STALE_TIME) {
            revert InvalidStaleTime();
        }

        uint256 oldMaxStaleTime = maxStaleTime;
        maxStaleTime = newMaxStaleTime;

        emit MaxStaleTimeUpdated(oldMaxStaleTime, newMaxStaleTime);
    }

    function setPrice(address token, uint256 priceUsd) external override onlyUpdater {
        _setPrice(token, priceUsd);
    }

    function setPrices(
        address[] calldata tokens,
        uint256[] calldata pricesUsd
    ) external override onlyUpdater {
        if (tokens.length != pricesUsd.length) revert LengthMismatch();

        for (uint256 i = 0; i < tokens.length; i++) {
            _setPrice(tokens[i], pricesUsd[i]);
        }
    }

    function _setPrice(address token, uint256 priceUsd) internal {
        if (token == address(0)) revert ZeroAddress();
        if (!_priceData[token].supported) revert UnsupportedToken();
        if (priceUsd == 0) revert InvalidPrice();

        _priceData[token].priceUsd = priceUsd;
        _priceData[token].updatedAt = block.timestamp;

        emit PriceUpdated(token, priceUsd, block.timestamp);
    }

    function getPrice(address token) external view override returns (uint256 priceUsd) {
        PriceData memory data = _priceData[token];

        if (!data.supported) revert UnsupportedToken();
        if (data.priceUsd == 0) revert NoPrice();

        return data.priceUsd;
    }

    function getPriceData(
        address token
    )
        external
        view
        override
        returns (
            uint256 priceUsd,
            uint256 updatedAt,
            bool supported
        )
    {
        PriceData memory data = _priceData[token];

        return (data.priceUsd, data.updatedAt, data.supported);
    }

    function lastUpdated(address token) external view override returns (uint256) {
        return _priceData[token].updatedAt;
    }

    function isFresh(address token) public view override returns (bool) {
        PriceData memory data = _priceData[token];

        if (!data.supported) return false;
        if (data.priceUsd == 0) return false;
        if (data.updatedAt == 0) return false;

        return block.timestamp <= data.updatedAt + maxStaleTime;
    }

    function isSupported(address token) external view override returns (bool) {
        return _priceData[token].supported;
    }

    function getFreshPrice(address token) external view returns (uint256 priceUsd) {
        PriceData memory data = _priceData[token];

        if (!data.supported) revert UnsupportedToken();
        if (data.priceUsd == 0) revert NoPrice();
        if (block.timestamp > data.updatedAt + maxStaleTime) revert StalePrice();

        return data.priceUsd;
    }
}
