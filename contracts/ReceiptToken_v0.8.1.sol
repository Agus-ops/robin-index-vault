// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

// ============================================================
// ReceiptToken (rINDEX) v0.8.1 — Minor cleanup
// ============================================================
// Perubahan dari v0.8.0:
//   - Hapus event OwnershipTransferred (redundan, OZ sudah punya)
//   - Sisanya TIDAK BERUBAH — non-transferable receipt token
// ============================================================

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract ReceiptToken is Ownable {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    address public vault;
    bool public vaultLocked;

    mapping(address => uint256) public balanceOf;

    error NotOwner();
    error ZeroAddress();
    error VaultAlreadyLocked();
    error InsufficientBalance();
    error NonTransferable();
    error NotVault();
    error InvalidAmount();

    event VaultLocked(address indexed vault);
    event VaultUpdated(address indexed oldVault, address indexed newVault);
    event Transfer(address indexed from, address indexed to, uint256 amount);

    constructor(
        string memory tokenName,
        string memory tokenSymbol,
        address initialOwner
    ) Ownable(initialOwner) {
        name = tokenName;
        symbol = tokenSymbol;
    }

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
        _;
    }

    function setVault(address newVault) external onlyOwner {
        if (vaultLocked) revert VaultAlreadyLocked();
        if (newVault == address(0)) revert ZeroAddress();
        address oldVault = vault;
        vault = newVault;
        emit VaultUpdated(oldVault, newVault);
    }

    function lockVault() external onlyOwner {
        if (vault == address(0)) revert ZeroAddress();
        vaultLocked = true;
        emit VaultLocked(address(vault));
    }

    function mint(address to, uint256 amount) external onlyVault {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function burn(address from, uint256 amount) external onlyVault {
        if (from == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();
        uint256 bal = balanceOf[from];
        if (bal < amount) revert InsufficientBalance();
        unchecked { balanceOf[from] = bal - amount; }
        totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }

    function transfer(address, uint256) external pure returns (bool) {
        revert NonTransferable();
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        revert NonTransferable();
    }

    function approve(address, uint256) external pure returns (bool) {
        revert NonTransferable();
    }

    function allowance(address, address) external pure returns (uint256) {
        return 0;
    }
}
