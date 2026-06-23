# Perbaikan MockStockOracle v0.8.1

## 1. Epoch-based approvals (Fix: Ghost approvals)
- Tambahkan `keeperEpoch` yang bertambah setiap ada perubahan keeper
- Mapping approval sekarang: `token => price => epoch => keeper => bool`
- Saat `keeperEpoch` berubah, semua approval lama otomatis invalid

## 2. Validasi requiredSignatures (Fix: upper bound)
- Tambahkan `keeperCount` yang dilacak setiap `setKeeper()`
- `setRequiredSignatures()` sekarang cek: `_required > 0 && _required <= keeperCount`

## 3. Explicit AlreadyApproved error
- Ganti `return;` silent dengan `revert AlreadyApproved();`
- Keeper tahu pasti jika approval-nya duplikat

## 4. Error InvalidRequiredSignatures
- Tambahkan error khusus untuk validasi threshold

## 5. Owner bypass tetap dipertahankan
- `setPrice()` / `setPrices()` tetap bisa dipanggil owner
- Ini disengaja untuk backward compatibility
