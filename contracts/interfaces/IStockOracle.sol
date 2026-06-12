// SPDX-License-Identifier: MIT
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
