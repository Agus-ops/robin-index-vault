# Robin Index Vault

Ledger-based stock-token vault MVP on Robinhood Chain Testnet.

## Live dApp UI v0.3.0

Robin Index Vault now includes a public frontend deployed on Vercel.

- **Open dApp:** https://robin-index-vault.vercel.app
- **Stack:** React + Vite + RainbowKit + wagmi + Vercel
- **Network:** Robinhood Chain Testnet, Chain ID `46630`
- **Status:** read-only vault data, wallet balances, rINDEX balance, treasury buckets, deposit, and withdraw actions are wired to the verified v0.2.0 contracts.

The frontend is a testnet interface only. It does not claim real stock ownership, guaranteed rewards, APY, APR, or real yield.


**v0.2.0 is the public-trust verified deployment.**
All core contracts are verified on the Robinhood Chain Testnet explorer using Solidity compiler `v0.8.34+commit.80d5c536`.

## Network

- Network: Robinhood Chain Testnet
- Chain ID: 46630
- Release: v0.2.0

## Verified v0.2.0 Contracts

| Contract | Address |
|---|---|
| MockStockOracle | `0xFB22dF75fFD1E89b23f9b9727880a22C039350a9` |
| ReceiptToken / rINDEX | `0x032F80b841c1677ae188d34004a8F6e5F4f576B4` |
| FeeTreasury | `0xf5579396bFaEd22a14fF43d09eD490ae78784211` |
| RobinIndexVault | `0x1f51A1c104115fD24D3389428BC7Dbe370d3466b` |
| RewardDistributor | `0x30a6dDfCf8e1Fa11Ce5B2A9745c54123A74e0d15` |

## Supported Assets

| Asset | Address | Decimals |
|---|---|---:|
| TSLA | `0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E` | 18 |
| AMZN | `0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02` | 18 |
| NFLX | `0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93` | 18 |
| PLTR | `0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0` | 18 |
| AMD | `0x71178BAc73cBeb415514eB542a8995b82669778d` | 18 |
| USDG | `0x7E955252E15c84f5768B83c41a71F9eba181802F` | 6 |

## Design

Users deposit supported stock tokens and receive non-transferable `rINDEX`.

Withdrawals return the original deposited underlying token. Withdraw does not depend on oracle price or portfolio NAV.

Protocol fees are split by `FeeTreasury`:

| Bucket | Share |
|---|---:|
| Reserve | 50% |
| Rewards | 30% |
| Router liquidity | 15% |
| Operator | 5% |

There is no fixed APY. There is no unlimited reward minting. Rewards are funded only by collected protocol fees.

## Verified Behavior

- Deposit works.
- Withdraw works.
- Withdraw works while the vault is paused.
- Deposit reverts while the vault is paused.
- Fees sweep into FeeTreasury.
- FeeTreasury splits fees atomically.
- `rINDEX` is non-transferable.
- ReceiptToken vault binding is locked.
- Portfolio NAV matches CLI calculation.
- RewardDistributor distributes only already-funded rewards.
- RewardDistributor is not a FeeTreasury keeper.

## v0.2.0 Smoke Test

Smoke test passed on the verified v0.2.0 deployment.

| Action | Transaction |
|---|---|
| Approve TSLA | `0x854ceb9e7f252312acfd9164c6c2e8dce2fb09e31371ff4172d6c3372611124e` |
| Deposit 0.1 TSLA | `0x36495ec2a5ffe10f7b8efe3cae2dfab9a60ddee9c1939bba2868a3f70f5d646c` |
| Withdraw 0.02 TSLA | `0xb87c3e4cf284253d78e292bf9a825d7c17bc6c68476f79880329ec7a57dde372` |
| Sweep TSLA fees | `0xf5ef4c7310a41aa62a049e45d58596b4908747446d763d30ba174fdd63823218` |

Post-smoke state:

| Metric | Value |
|---|---:|
| User TSLA vault balance | 0.0797 TSLA |
| User rINDEX balance | 14.346 rINDEX |
| Treasury TSLA received | 0.0005 TSLA |
| Treasury TSLA reserve | 0.00025 TSLA |
| Treasury TSLA rewards | 0.00015 TSLA |
| Treasury TSLA router | 0.000075 TSLA |
| Treasury TSLA operator | 0.000025 TSLA |

## Test Summary

Runtime invariant check after v0.2.0 smoke:

- Passes: 65
- Warnings: 0
- Failures: 0

Additional tests covered:

- Oracle stale withdraw test
- Treasury dust split test
- Full vault pause behavior test
- Treasury pause behavior test
- Recovery guard test
- Early withdraw fee test
- Daily rebalance cooldown test
- Multi-user ledger test
- Reward flow smoke test

Full v0.2.0 report:

- `reports/v0.2.0/verification.md`

## CLI

Install dependencies:

`npm install`

Compile:

`npm run compile`

Status:

`npm run status`

Run invariant check:

`npm run invariant`

Deposit example:

`npm run deposit -- AMZN 0.05`

Withdraw example:

`npm run withdraw -- TSLA 0.01`

Sweep fees example:

`npm run sweep -- AMZN`

## Security Notes

- `rINDEX` is non-transferable.
- `ReceiptToken.vaultLocked` is true.
- Vault pause blocks deposits but does not block withdrawals.
- Withdrawals return the underlying deposited token.
- Rewards are funded only by collected protocol fees.
- RewardDistributor does not mint rewards.
- RewardDistributor does not call `FeeTreasury.withdrawBucket`.
- FeeTreasury owner or keeper manually funds RewardDistributor from rewards bucket funds.

## Legacy Deployments

v0.1.1 remains archived as the previous proven MVP deployment.

The v0.1.x contracts were valid and locally reproducible, but Robinhood Testnet Blockscout did not list solc `v0.8.35+commit.47b9dedd`. v0.2.0 was redeployed with verifier-supported solc `v0.8.34+commit.80d5c536` so all core contracts can be publicly verified on the explorer.

Archived deployment file:

- `deployments/archive/robinhood-46630-v0.1.1.json`
