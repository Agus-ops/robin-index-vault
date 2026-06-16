# Robin Index Vault

Testnet stock-token index vault on Robinhood Chain Testnet (Chain ID 46630).

**Live dApp:** https://robin-index-vault.vercel.app

---

## Contracts

| Module | Address |
|--------|-------|
| MockStockOracle | `0xC1c84d45DB3CD10e300CCc84F6900995c2260d1A` |
| ReceiptToken (rINDEX) | `0x54269f54c3B28e6E23e2D2d79BD8b9c9C501bcC2` |
| FeeTreasury | `0x05FbC935652605B697522B3f0bd4c14FfBAb8209` |
| RobinIndexVault | `0x99E535AbCcCF89d6596F5c27cD3244317c1C2450` |
| RewardDistributor | `0xf559F8511022bBb63137523356d19ec4aCBadd53` |

---

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19 + Vite 8 |
| Web3 | wagmi 2 + viem 2 + RainbowKit 2 |
| Database | Supabase (leaderboard + check-in history) |
| Oracle API | Twelve Data |
| Deploy | Vercel |

---

## Implemented

- Multi-token vault ledger (TSLA, AMZN, NFLX, PLTR, AMD, USDG)
- Non-transferable rINDEX receipt token (account-bound, vaultLocked)
- Deposit and withdrawal (ledger-based)
- Fee treasury with automatic bucket split (50/30/15/5)
- Fee-funded reward distributor with weekly allocation and claim
- Daily check-in (on-chain, 24h cooldown)
- Leaderboard with points system (Supabase-backed)
- Live oracle prices on landing page
- Keeper-managed oracle updates via Twelve Data (every 30 minutes)
- Keeper-managed fee sweep and weekly reward funding
- Operator Control Room, Oracle Manager, Verified Contracts dashboard
- Mobile-optimized neon UI (black + neon pink + neon green)

---

## Deferred

- StockRouter (internal swap/rebalance)
- Bridge to Sepolia
- Merkle Distributor v2
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

## Points System

| Action | Points |
|--------|--------|
| Deposit | +10 |
| Withdraw | -5 |
| Daily Check-in | +1 |

Leaderboard updated every 30 minutes via keeper loop.

---

## Keeper

```bash
tmux new-session -d -s keeper 'cd /opt/robin-index-vault && EXEC=1 bash scripts/run-keeper-loop.sh'
```

---

## Frontend Setup

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

---

## Safety Notice

Testnet demo only. No real stock ownership, no investment yield, no guaranteed rewards, no APY.
