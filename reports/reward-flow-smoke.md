# RewardDistributor Smoke Test — Robinhood Chain Testnet

## Status

Passed.

This smoke test proves the full reward lifecycle:

FeeTreasury rewards bucket -> RewardDistributor -> funded weekly pool -> user allocation -> capped user claim.

## Contracts

- FeeTreasury: `0x94d6BF3eb29D15642eE10ad5d1164749eB880961`
- RewardDistributor: `0x24BB0D5e6631a698a06819D8DD15Adbe4630727a`
- AMZN token: `0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02`

## Safety Configuration

- `FeeTreasury.rewardDistributor` was set to RewardDistributor.
- RewardDistributor was confirmed NOT to be a FeeTreasury keeper.
- RewardDistributor does not call `FeeTreasury.withdrawBucket`.
- FeeTreasury owner/keeper manually sends rewards bucket funds to RewardDistributor.
- RewardDistributor only registers already-received unallocated balances through `fundWeek`.

## Transactions

- `setRewardDistributor`: `0x6c489d63f920f5c6757d64d7447fe76adf3a50fcd871107b169a6d1166d01dff`
- Temporary AMZN threshold lowering to `0.00001`: `0x3c52b0ff3e9056960f0c289966a9a79b9fe9b9e2c6ada0454f6b61e295fd97ac`
- Withdraw AMZN rewards bucket to RewardDistributor: `0x4118e8ca03bb0bcae932c59b595a312d0cfb8610ef2992946388a81c641afd40`
- Set AMZN token config: `0x4e4df33fd3ba654b04d000fb6677bd4b253cd8eecc3a392bc1a2cfcb07c532ed`
- Fund week 2945: `0x7f335820859eb77c23c717aaefdbbfbc41a29c50d31c1e07d5bba840826431e8`
- Set second wallet allocation: `0x754384bdf270619550df37f556ed431812654c16ddb6db48bc879714922e92fb`
- Second wallet claim: `0x92eaa075ddcffbb028e7a3ed4bdf416f3aa976ea7a6b923b6090bf136b1b4932`

## Test Values

- Week: `2945`
- Fund amount: `0.00005 AMZN`
- Allocation: `0.00002 AMZN`
- Max claim per user: `0.0000025 AMZN`
- Second wallet received: `0.0000025 AMZN`
- Claimed record: `0.0000025 AMZN`
- Week claimed total: `0.0000025 AMZN`
- Claimable after claim: `0`

## Result

- Claim was capped by the 5% relative cap.
- Second wallet received exactly the capped amount.
- Double claim was blocked.
- Reward flow passed end-to-end.

## Note

AMZN distribution threshold was temporarily lowered from `0.5` to `0.00001` for this testnet smoke test because the rewards bucket was intentionally small.
