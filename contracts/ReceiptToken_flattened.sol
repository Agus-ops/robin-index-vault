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


// File contracts/ReceiptToken.sol

// Original license: SPDX_License_Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ReceiptToken
 * @notice Non-transferable rINDEX receipt/score token for Robin Index Vault.
 */
contract ReceiptToken is IReceiptToken {
    string public override name;
    string public override symbol;
    uint8 public constant override decimals = 18;

    uint256 public override totalSupply;
    address public owner;
    address public override vault;
    bool public vaultLocked;

    mapping(address => uint256) public override balanceOf;

    error NotOwner();
    error ZeroAddress();
    error VaultLocked();
    error InsufficientBalance();
    error InvalidAmount();

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event VaultLockFinalized(address indexed vault);

    event Transfer(address indexed from, address indexed to, uint256 amount);

    constructor(
        string memory tokenName,
        string memory tokenSymbol,
        address initialOwner
    ) {
        address resolvedOwner = initialOwner == address(0) ? msg.sender : initialOwner;

        name = tokenName;
        symbol = tokenSymbol;
        owner = resolvedOwner;

        emit OwnershipTransferred(address(0), resolvedOwner);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
        _;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();

        address oldOwner = owner;
        owner = newOwner;

        emit OwnershipTransferred(oldOwner, newOwner);
    }

    function setVault(address newVault) external override onlyOwner {
        if (vaultLocked) revert VaultLocked();
        if (newVault == address(0)) revert ZeroAddress();

        address oldVault = vault;
        vault = newVault;

        emit VaultUpdated(oldVault, newVault);
    }

    function lockVault() external onlyOwner {
        if (vault == address(0)) revert ZeroAddress();

        vaultLocked = true;

        emit VaultLockFinalized(vault);
    }

    function mint(address to, uint256 amount) external override onlyVault {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();

        totalSupply += amount;
        balanceOf[to] += amount;

        emit Transfer(address(0), to, amount);
    }

    function burn(address from, uint256 amount) external override onlyVault {
        if (from == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();

        uint256 bal = balanceOf[from];
        if (bal < amount) revert InsufficientBalance();

        unchecked {
            balanceOf[from] = bal - amount;
            totalSupply -= amount;
        }

        emit Transfer(from, address(0), amount);
    }

    function allowance(address, address) external pure override returns (uint256) {
        return 0;
    }

    function approve(address, uint256) external pure override returns (bool) {
        revert NonTransferable();
    }

    function transfer(address, uint256) external pure override returns (bool) {
        revert NonTransferable();
    }

    function transferFrom(address, address, uint256) external pure override returns (bool) {
        revert NonTransferable();
    }
}
