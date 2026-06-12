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
