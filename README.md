# Robin Index Vault

Ledger-based stock-token vault MVP on Robinhood Chain Testnet.

Network: Robinhood Chain Testnet
Chain ID: 46630

## Contracts

MockStockOracle:
0x09FcC88e4d70DE7e0feA45D422E01D2b6922E3Aa

ReceiptToken / rINDEX:
0xeBA481658622F6b3893D57F58530AfA4F443bEdE

FeeTreasury:
0x94d6BF3eb29D15642eE10ad5d1164749eB880961

RobinIndexVault:
0xD39a604Ddc92115C5cB0F70fc85AC5581D9e81A7

## Supported Assets

TSLA: 0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E
AMZN: 0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02
NFLX: 0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93
PLTR: 0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0
AMD:  0x71178BAc73cBeb415514eB542a8995b82669778d
USDG: 0x7E955252E15c84f5768B83c41a71F9eba181802F

Stock tokens use 18 decimals.
USDG uses 6 decimals.

## Design

Users deposit supported stock tokens and receive non-transferable rINDEX.

Withdrawals return the underlying deposited token.

Withdraw does not depend on oracle price or NAV.

Protocol fees are recycled into:
- 50 percent Reserve
- 30 percent Rewards
- 15 percent Router liquidity
- 5 percent Operator

There is no fixed APY.
There is no unlimited reward minting.

## Verified MVP Behavior

Deposit works.
Withdraw works.
Withdraw works while vault is paused.
Deposit reverts while vault is paused.
Fees sweep into FeeTreasury.
FeeTreasury splits fees atomically.
rINDEX vault binding is locked.
Portfolio NAV matches CLI calculation.

## CLI

npm install
npm run compile
npm run status
npm run deposit -- AMZN 0.05
npm run withdraw -- TSLA 0.01
npm run sweep -- AMZN

## Security Notes

rINDEX is non-transferable.
ReceiptToken vaultLocked is true.
pause blocks deposits but not withdrawals.
Rewards are funded only by collected protocol fees.

## Latest Protocol Status

Robin Index Vault is live on Robinhood Chain Testnet as a stock-token vault MVP with non-transferable rINDEX, fee accounting, treasury buckets, and capped reward distribution.

### Deployed Contracts

Network: Robinhood Chain Testnet, chainId 46630.

| Contract | Address |
|---|---|
| MockStockOracle | 0x09FcC88e4d70DE7e0feA45D422E01D2b6922E3Aa |
| ReceiptToken / rINDEX | 0xeBA481658622F6b3893D57F58530AfA4F443bEdE |
| FeeTreasury | 0x94d6BF3eb29D15642eE10ad5d1164749eB880961 |
| RobinIndexVault | 0xD39a604Ddc92115C5cB0F70fc85AC5581D9e81A7 |
| RewardDistributor | 0x24BB0D5e6631a698a06819D8DD15Adbe4630727a |

### Proven Features

- Stock-token deposits mint non-transferable rINDEX.
- Withdrawals return the original underlying token.
- Withdrawals remain available while the vault is paused.
- Fees are split into reserve, rewards, router, and operator buckets.
- Multi-user accounting is isolated.
- rINDEX totalSupply matches watched user receipts.
- RewardDistributor distributes only already-funded rewards.
- Rewards are capped by weekly allocation, 5% relative cap, and absolute per-token cap.
- Double claims are blocked.

### Test Summary

- Runtime invariant: 65 passes / 0 warnings / 0 failures
- Oracle stale withdraw test: passed
- Treasury dust split test: passed
- Full vault pause behavior test: passed
- Treasury pause behavior test: passed
- Recovery guard test: passed
- Early withdraw fee test: passed
- Daily rebalance cooldown test: passed
- Multi-user ledger test: passed
- Reward flow smoke test: passed

### Reward Flow

FeeTreasury rewards bucket -> RewardDistributor -> weekly pool -> allocation -> capped user claim.

Smoke test report:

- reports/reward-flow-smoke.md

### RewardDistributor Safety

- RewardDistributor is not a FeeTreasury keeper.
- RewardDistributor does not call FeeTreasury.withdrawBucket.
- FeeTreasury owner/keeper manually sends rewards bucket funds to RewardDistributor.
- RewardDistributor only registers already-received unallocated balances through fundWeek.
- AMZN distribution threshold was temporarily lowered for smoke testing, then restored to 0.5.

### Useful Commands

- npm run compile
- npm run status
- npm run invariant
- npm run test-multi-user



## v0.2.0 Public-Trust Verified Deployment

Robin Index Vault v0.2.0 is the full verified public-trust deployment on Robinhood Chain Testnet. All core contracts are verified on the explorer using Solidity compiler v0.8.34+commit.80d5c536.

Contracts:

- MockStockOracle: 0xFB22dF75fFD1E89b23f9b9727880a22C039350a9
- ReceiptToken / rINDEX: 0x032F80b841c1677ae188d34004a8F6e5F4f576B4
- FeeTreasury: 0xf5579396bFaEd22a14fF43d09eD490ae78784211
- RobinIndexVault: 0x1f51A1c104115fD24D3389428BC7Dbe370d3466b
- RewardDistributor: 0x30a6dDfCf8e1Fa11Ce5B2A9745c54123A74e0d15

Status:

- All core contracts verified on Robinhood Testnet explorer.
- Smoke test passed: approve, deposit, withdraw, and sweep fees.
- Runtime invariant check passed after smoke: 65 passes, 0 warnings, 0 failures.
- ReceiptToken vault binding locked.
- FeeTreasury configured with the v0.2 vault as fee source.
- FeeTreasury configured with the v0.2 RewardDistributor.
- RewardDistributor is not a FeeTreasury keeper.

Legacy note:

v0.1.1 remains the previous proven MVP deployment. v0.2.0 is the public-trust deployment created so all core contracts are explorer-verified.

