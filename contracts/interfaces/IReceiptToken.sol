// SPDX-License-Identifier: MIT
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
