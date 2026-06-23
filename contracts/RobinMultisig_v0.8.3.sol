// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

// ============================================================
// RobinMultisig v0.8.3 — Patch: autoExecuteEnabled switch
// ============================================================
// Fixes:
//   - Tambahkan bool public autoExecuteEnabled (default true)
//   - confirmTransaction: auto-execute hanya jika autoExecuteEnabled == true
//   - Toggle via governance: setAutoExecute(bool) → onlySelf
// ============================================================

contract RobinMultisig {
    error NotOwner();
    error OnlySelf();
    error TxNotFound();
    error AlreadyExecuted();
    error AlreadyConfirmed();
    error NotConfirmed();
    error Reentrancy();
    error ZeroAddress();
    error DuplicateOwner();
    error DuplicateRequestId();
    error InsufficientConfirmations();
    error TxFailed();
    error NoOwners();
    error InvalidRequirement();
    error WouldLockRequired();
    error TimelockNotExpired();
    error InvalidTimelock();
    error InsufficientBalance();
    error TxAlreadyCancelled();

    event OwnerAdded(address indexed owner);
    event OwnerRemoved(address indexed owner);
    event RequirementChanged(uint256 newRequirement);
    event TxSubmitted(
        uint256 indexed txId,
        bytes32 indexed requestId,
        address indexed submitter,
        address to,
        uint256 value,
        bytes data,
        uint256 timelockDeadline
    );
    event TxConfirmed(address indexed owner, uint256 indexed txId);
    event TxRevoked(address indexed owner, uint256 indexed txId);
    event TxExecuted(uint256 indexed txId);
    event TxCancelled(uint256 indexed txId, address indexed canceller);
    event TimelockUpdated(uint256 oldTimelock, uint256 newTimelock);
    event AutoExecuteUpdated(bool enabled);
    event Received(address indexed sender, uint256 amount);

    address[] public owners;
    mapping(address => bool) public isOwner;
    uint256 public required;

    /// @notice Timelock untuk transaksi admin (add/remove owner, change requirement, setTimelock)
    /// @dev Default 24 jam. Bisa diubah via governance (submit → confirm → execute ke setAdminTimelock)
    uint256 public adminTimelock = 24 hours;

    /// @notice Flag untuk mengaktifkan/menonaktifkan auto‑eksekusi
    /// @dev Default true (auto‑execute aktif). Nonaktifkan jika RPC tidak stabil
    ///      atau untuk debugging. Bisa diubah via governance.
    bool public autoExecuteEnabled = true;

    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        bool executed;
        uint256 confirmations;
        uint256 createdAt;
        bytes32 requestId;
        bool cancelled;
    }

    Transaction[] public transactions;
    mapping(uint256 => mapping(address => bool)) public confirmed;
    mapping(bytes32 => bool) public executedRequestIds;
    mapping(uint256 => uint256) public timelockDeadline;
    bool private _executing;

    modifier onlyOwner() {
        if (!isOwner[msg.sender]) revert NotOwner();
        _;
    }

    modifier onlySelf() {
        if (msg.sender != address(this)) revert OnlySelf();
        _;
    }

    modifier txExists(uint256 txId) {
        if (txId >= transactions.length) revert TxNotFound();
        _;
    }

    modifier notExecuted(uint256 txId) {
        if (transactions[txId].executed) revert AlreadyExecuted();
        _;
    }

    modifier notCancelled(uint256 txId) {
        if (transactions[txId].cancelled) revert TxAlreadyCancelled();
        _;
    }

    modifier noReentrant() {
        if (_executing) revert Reentrancy();
        _executing = true;
        _;
        _executing = false;
    }

    constructor(address[] memory _owners, uint256 _required) {
        if (_owners.length == 0) revert NoOwners();
        if (_required == 0 || _required > _owners.length) revert InvalidRequirement();

        for (uint256 i = 0; i < _owners.length; i++) {
            address owner = _owners[i];
            if (owner == address(0)) revert ZeroAddress();
            if (isOwner[owner]) revert DuplicateOwner();
            isOwner[owner] = true;
            owners.push(owner);
            emit OwnerAdded(owner);
        }
        required = _required;
        emit RequirementChanged(_required);
    }

    function submitTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        bytes32 requestId
    ) external onlyOwner returns (uint256 txId) {
        if (to == address(0)) revert ZeroAddress();
        if (executedRequestIds[requestId]) revert DuplicateRequestId();

        executedRequestIds[requestId] = true;

        transactions.push(
            Transaction({
                to: to,
                value: value,
                data: data,
                executed: false,
                confirmations: 0,
                createdAt: block.timestamp,
                requestId: requestId,
                cancelled: false
            })
        );

        txId = transactions.length - 1;

        if (_isAdminTransaction(to, data)) {
            uint256 deadline = block.timestamp + adminTimelock;
            timelockDeadline[txId] = deadline;
        }

        confirmed[txId][msg.sender] = true;
        transactions[txId].confirmations = 1;

        emit TxSubmitted(txId, requestId, msg.sender, to, value, data, timelockDeadline[txId]);
        emit TxConfirmed(msg.sender, txId);
    }

    function confirmTransaction(uint256 txId)
        external
        onlyOwner
        txExists(txId)
        notExecuted(txId)
        notCancelled(txId)
    {
        if (confirmed[txId][msg.sender]) revert AlreadyConfirmed();
        confirmed[txId][msg.sender] = true;
        transactions[txId].confirmations += 1;
        emit TxConfirmed(msg.sender, txId);

        // Auto-execute: hanya jika threshold terpenuhi, timelock expired (atau tidak ada),
        // DAN autoExecuteEnabled == true
        if (autoExecuteEnabled && transactions[txId].confirmations >= required) {
            uint256 deadline = timelockDeadline[txId];
            if (deadline == 0 || block.timestamp >= deadline) {
                _executeTransaction(txId);
            }
        }
    }

    function revokeConfirmation(uint256 txId)
        external
        onlyOwner
        txExists(txId)
        notExecuted(txId)
        notCancelled(txId)
    {
        if (!confirmed[txId][msg.sender]) revert NotConfirmed();
        confirmed[txId][msg.sender] = false;
        transactions[txId].confirmations -= 1;
        emit TxRevoked(msg.sender, txId);
    }

    function executeTransaction(uint256 txId)
        external
        onlyOwner
        txExists(txId)
        notExecuted(txId)
        notCancelled(txId)
    {
        if (transactions[txId].confirmations < required) revert InsufficientConfirmations();
        _executeTransaction(txId);
    }

    function cancelTransaction(uint256 txId)
        external
        onlyOwner
        txExists(txId)
        notExecuted(txId)
        notCancelled(txId)
    {
        if (!confirmed[txId][msg.sender]) revert NotConfirmed();
        transactions[txId].cancelled = true;
        emit TxCancelled(txId, msg.sender);
    }

    function _executeTransaction(uint256 txId) internal noReentrant {
        Transaction storage txn = transactions[txId];
        if (txn.executed) revert AlreadyExecuted();
        if (txn.cancelled) revert TxAlreadyCancelled();

        uint256 deadline = timelockDeadline[txId];
        if (deadline > 0 && block.timestamp < deadline) revert TimelockNotExpired();

        if (txn.value > address(this).balance) revert InsufficientBalance();

        txn.executed = true;
        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        if (!success) revert TxFailed();
        emit TxExecuted(txId);
    }

    function _isAdminTransaction(address to, bytes calldata data) internal view returns (bool) {
        if (to != address(this)) return false;
        if (data.length < 4) return false;
        bytes4 selector = bytes4(data[:4]);
        return selector == this.addOwner.selector ||
               selector == this.removeOwner.selector ||
               selector == this.changeRequirement.selector ||
               selector == this.setAdminTimelock.selector ||
               selector == this.setAutoExecute.selector;
    }

    function addOwner(address newOwner) external onlySelf {
        if (newOwner == address(0)) revert ZeroAddress();
        if (isOwner[newOwner]) revert DuplicateOwner();
        isOwner[newOwner] = true;
        owners.push(newOwner);
        emit OwnerAdded(newOwner);
    }

    /// @notice Hapus owner dari multisig.
    /// @dev WARNING: Menggunakan swap-and-pop untuk efisiensi gas. URUTAN ARRAY
    ///      owners AKAN BERUBAH setelah penghapusan. Off-chain indexers atau
    ///      frontend yang meng-cache owners harus re-sync setelah event OwnerRemoved.
    function removeOwner(address owner) external onlySelf {
        if (!isOwner[owner]) revert NotOwner();
        if (owners.length - 1 < required) revert WouldLockRequired();
        isOwner[owner] = false;
        uint256 len = owners.length;
        for (uint256 i = 0; i < len; i++) {
            if (owners[i] == owner) {
                owners[i] = owners[len - 1];
                owners.pop();
                break;
            }
        }
        emit OwnerRemoved(owner);
    }

    function changeRequirement(uint256 newRequired) external onlySelf {
        if (newRequired == 0 || newRequired > owners.length) revert InvalidRequirement();
        required = newRequired;
        emit RequirementChanged(newRequired);
    }

    function setAdminTimelock(uint256 newTimelock) external onlySelf {
        if (newTimelock > 7 days) revert InvalidTimelock();
        uint256 oldTimelock = adminTimelock;
        adminTimelock = newTimelock;
        emit TimelockUpdated(oldTimelock, newTimelock);
    }

    function setAutoExecute(bool enabled) external onlySelf {
        autoExecuteEnabled = enabled;
        emit AutoExecuteUpdated(enabled);
    }

    function getOwners() external view returns (address[] memory) {
        return owners;
    }

    function getTransactionCount() external view returns (uint256) {
        return transactions.length;
    }

    function getConfirmationCount(uint256 txId) external view txExists(txId) returns (uint256) {
        return transactions[txId].confirmations;
    }

    function isConfirmedBy(uint256 txId, address owner) external view txExists(txId) returns (bool) {
        return confirmed[txId][owner];
    }

    function getTransaction(uint256 txId)
        external
        view
        txExists(txId)
        returns (
            address to,
            uint256 value,
            bytes memory data,
            bool executed,
            uint256 confirmations,
            uint256 createdAt,
            bytes32 requestId,
            bool cancelled,
            uint256 timelockDeadline_
        )
    {
        Transaction storage txn = transactions[txId];
        return (
            txn.to, txn.value, txn.data, txn.executed,
            txn.confirmations, txn.createdAt, txn.requestId,
            txn.cancelled, timelockDeadline[txId]
        );
    }

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }
}
