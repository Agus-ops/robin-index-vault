# Robin Index Vault

Testnet stock-token index vault on Robinhood Chain Testnet (Chain ID 46630).

**Live dApp:** https://robin-index-vault.vercel.app
**Repo:** https://github.com/Agus-ops/robin-index-vault

---

## Contracts

| Module | Address |
|--------|---------|
| MockStockOracle | 0xC1c84d45DB3CD10e300CCc84F6900995c2260d1A |
| ReceiptToken (rINDEX) | 0x54269f54c3B28e6E23e2D2d79BD8b9c9C501bcC2 |
| FeeTreasury | 0x05FbC935652605B697522B3f0bd4c14FfBAb8209 |
| RobinIndexVault | 0x99E535AbCcCF89d6596F5c27cD3244317c1C2450 |
| RewardDistributor | 0xf559F8511022bBb63137523356d19ec4aCBadd53 |

---

## Implemented

- Multi-token vault ledger (TSLA, AMZN, NFLX, PLTR, AMD, USDG)
- Non-transferable rINDEX receipt token (account-bound, vaultLocked)
- Deposit and withdrawal (ledger-based, no oracle dependency on withdraw)
- Fee treasury with automatic bucket split (50/30/15/5)
- Fee-funded reward distributor with weekly allocation and claim
- RewardPanel with per-token claimable display and Claim button
- Auto-refresh after claim confirmation
- Keeper-managed oracle updates via Finnhub API
- Keeper-managed fee sweep, reward funding, and weekly cycle
- Operator Control Room, Oracle Manager, Verified Contracts dashboard
- Mobile-optimized green terminal UI

## Deferred

- StockRouter (internal swap/rebalance)
- Bridge to Sepolia
- Merkle Distributor v2
- Daily check-in UI
- Leaderboard / soft reward system
- USDG as active reward token

---

## Treasury Buckets

| Bucket | Split |
|--------|-------|
| Protocol Reserve | 50% |
| User Rewards Pool | 30% |
| Router Liquidity | 15% |
| Admin Ops | 5% |

Rewards are fee-funded only. No minting, no fixed APY, no subsidy.

---

## Keeper

Runs in tmux session `robin-keeper`. Handles oracle updates, fee sweeps, and weekly reward funding every 4 hours.

    tmux new -s robin-keeper
    ./scripts/run-keeper-loop.sh

---

## Release

**v0.5.1** — Mobile UI Polish & Reward Panel Fix

- Reward Refresh button fixed (invalidateQueries)
- Auto-refresh after claim
- Mobile: summary 3-col, bucket 2-col, admin 3-col
- backdrop-filter disabled on mobile (performance)
- Homepage hero updated, Claim Rewards card added
- Network badge moved to topbar left

---

## Safety Notice

Testnet demo only. No real stock ownership, no investment yield, no guaranteed rewards.
