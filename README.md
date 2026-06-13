Robin Index Vault

Robin Index Vault is a testnet stock-token vault demo on Robinhood Chain Testnet.

The dApp demonstrates ledger-based deposits for supported testnet assets, non-transferable rINDEX receipt accounting, transparent treasury buckets, operator fee sweeping, and keeper-managed mock oracle updates.

Live dApp:

https://robin-index-vault.vercel.app

Repository:

https://github.com/Agus-ops/robin-index-vault

---

Status

Implemented:

- Multi-token vault ledger
- TSLA, AMZN, NFLX, PLTR, AMD testnet stock-token support
- USDG settlement-style test token support
- Non-transferable rINDEX receipt token
- Deposit and withdrawal flow
- Treasury bucket accounting
- Manual per-token protocol fee sweep
- Keeper-managed mock oracle updates
- Keeper-managed pending fee sweep checks
- Operator Control Room
- Oracle Manager
- Contract status dashboard
- Mobile-friendly green terminal UI
- Lightweight frontend auto-refresh for keeper-updated state

Deferred:

- Emergency pause UI
- Treasury withdrawal UI
- Owner/operator management UI
- Public bridge functionality
- Real-time market oracle claims

---

Core Model

Robin Index Vault uses a token-specific vault ledger.

Deposits remain asset-specific. A TSLA deposit is tracked as TSLA, an AMZN deposit is tracked as AMZN, and so on. Withdrawals return the original deposited token from the user’s vault ledger balance.

Supported assets:

- TSLA testnet stock token
- AMZN testnet stock token
- NFLX testnet stock token
- PLTR testnet stock token
- AMD testnet stock token
- USDG settlement-style test token

---

rINDEX Receipt

rINDEX is a non-transferable receipt token used for vault accounting.

It is not designed as a tradable asset, yield token, stock token, or claim on real-world equities.

rINDEX behavior:

- Minted when supported assets are deposited
- Burned or adjusted during withdrawals
- Represents account-bound vault receipt accounting
- Cannot be freely transferred
- Does not imply APY, APR, yield, or guaranteed rewards

---

Treasury Buckets

Protocol fees are routed into transparent treasury buckets.

Current bucket split:

- Protocol Reserve: 50%
- User Rewards Pool: 30%
- Router Liquidity: 15%
- Admin Ops: 5%

Rewards are fee-funded only. The system does not claim guaranteed rewards, APY, APR, or investment return.

---

Oracle Model

Robin Index Vault uses mock testnet oracle prices for vault accounting.

Oracle values are used for:

- Estimated vault value
- rINDEX accounting display
- Deposit and withdrawal estimates
- Treasury and portfolio valuation

The oracle is not a real-time trading oracle and should not be treated as live market infrastructure.

---

Keeper Automation

Robin Index Vault includes an operator-side keeper for testnet maintenance.

The keeper handles:

- Periodic mock stock oracle updates using stock reference prices
- Automatic protocol fee sweep checks
- Treasury bucket fee routing
- Price-change guard enforcement

The keeper is designed for slow-cadence testnet accounting, not high-frequency market updates.

Safety model:

- Dry-run by default
- "EXEC=1" required before transactions are submitted
- Default price movement guard is 10%
- "FORCE=1" reserved for reviewed first-sync or recovery operations
- Failed API reads are skipped
- Invalid or zero prices are skipped
- Emergency controls remain manual admin actions

Commands:

npm run oracle-keeper
EXEC=1 npm run oracle-keeper
FORCE=1 EXEC=1 npm run oracle-keeper
./scripts/run-keeper-loop.sh

Never commit local environment files, private keys, API keys, or wallet secrets.

---

Fee Sweep Automation

The keeper can sweep pending protocol fees from the vault into treasury buckets.

This action only moves accumulated protocol fees already recorded by the vault. It does not withdraw user ledger balances and does not alter user ownership of deposited assets.

Manual sweep remains available in the Operator Control Room as a fallback.

---

Frontend Behavior

The frontend reads live contract state from Robinhood Chain Testnet.

Main views:

- Vault Ledger
- rINDEX Balance
- Treasury & Rewards
- Operator Control Room
- Oracle Manager
- Contracts

The UI includes lightweight auto-refresh so keeper-updated oracle values and fee sweep state can appear without requiring a full page reload.

Deposit and withdrawal modals use responsive UI estimates. Final fee, mint, burn, and withdrawal values are enforced by the verified smart contracts.

---

Safety Notice

Robin Index Vault is a testnet builder demo.

It does not provide:

- Real stock ownership
- Real-world asset redemption
- Investment yield
- Guaranteed rewards
- Guaranteed APY or APR
- Real-time trading prices
- Custodial financial service

All values shown in the UI are for testnet vault accounting and demonstration purposes.

---

Suggested Release

Current suggested release label:

v0.4.0 — Keeper Automation

Release scope:

- Operator-side oracle keeper
- Protocol fee sweep automation
- Keeper-aware frontend wording
- 60-second frontend state refresh
- Public-safe automation documentation
