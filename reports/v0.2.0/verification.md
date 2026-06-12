# Robin Index Vault v0.2.0 Verification Report

Robin Index Vault v0.2.0 is a full public-trust redeploy on Robinhood Chain Testnet using Solidity compiler v0.8.34+commit.80d5c536.

Reason:
The previous v0.1.x core contracts were valid and locally reproducible, but Robinhood Testnet Blockscout did not list solc v0.8.35+commit.47b9dedd. To improve public trust, all core contracts were redeployed with a verifier-supported compiler and verified on the explorer.

Verified contracts:
- MockStockOracle: 0xFB22dF75fFD1E89b23f9b9727880a22C039350a9
- ReceiptToken / rINDEX: 0x032F80b841c1677ae188d34004a8F6e5F4f576B4
- FeeTreasury: 0xf5579396bFaEd22a14fF43d09eD490ae78784211
- RobinIndexVault: 0x1f51A1c104115fD24D3389428BC7Dbe370d3466b
- RewardDistributor: 0x30a6dDfCf8e1Fa11Ce5B2A9745c54123A74e0d15

Verification result:
All core contracts are verified on Robinhood Testnet explorer with compiler v0.8.34+commit.80d5c536.

Smoke test:
- Approve TSLA tx: 0x854ceb9e7f252312acfd9164c6c2e8dce2fb09e31371ff4172d6c3372611124e
- Deposit 0.1 TSLA tx: 0x36495ec2a5ffe10f7b8efe3cae2dfab9a60ddee9c1939bba2868a3f70f5d646c
- Withdraw 0.02 TSLA tx: 0xb87c3e4cf284253d78e292bf9a825d7c17bc6c68476f79880329ec7a57dde372
- Sweep fees tx: 0xf5ef4c7310a41aa62a049e45d58596b4908747446d763d30ba174fdd63823218

Post-smoke state:
- User TSLA vault balance: 0.0797 TSLA
- User rINDEX balance: 14.346 rINDEX
- Treasury TSLA received: 0.0005 TSLA
- Treasury TSLA reserve: 0.00025 TSLA
- Treasury TSLA rewards: 0.00015 TSLA
- Treasury TSLA router: 0.000075 TSLA
- Treasury TSLA operator: 0.000025 TSLA

Safety checks:
- ReceiptToken vault binding is locked.
- FeeTreasury allows the v0.2 vault as fee source.
- FeeTreasury points to the v0.2 RewardDistributor.
- RewardDistributor is not a FeeTreasury keeper.
- Oracle prices are configured and fresh.
- Supported token configs match deployment config.
- Runtime invariant check passed after smoke: 65 passes, 0 warnings, 0 failures.

v0.1.1 remains archived as the legacy proven MVP deployment.
v0.2.0 is the public-trust verified deployment.
