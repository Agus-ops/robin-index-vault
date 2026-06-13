try { require("dotenv").config(); } catch {}

const { ethers } = require("ethers");

const RPC_URL =
  process.env.ROBIN_RPC ||
  process.env.ROBINHOOD_RPC_URL ||
  process.env.RPC_URL ||
  process.env.VITE_ROBINHOOD_RPC_URL;

const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!RPC_URL) throw new Error("Missing RPC env: ROBIN_RPC or RPC_URL");
if (!PRIVATE_KEY) throw new Error("Missing PRIVATE_KEY env");

const isV6 = !!ethers.JsonRpcProvider;
const provider = isV6
  ? new ethers.JsonRpcProvider(RPC_URL)
  : new ethers.providers.JsonRpcProvider(RPC_URL);

const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

const parseUnits = (v, d) =>
  isV6 ? ethers.parseUnits(v, d) : ethers.utils.parseUnits(v, d);

const formatUnits = (v, d) =>
  isV6 ? ethers.formatUnits(v, d) : ethers.utils.formatUnits(v, d);

const toBig = (v) => typeof v === "bigint" ? v : BigInt(v.toString());
const fromBig = (v) => isV6 ? v : ethers.BigNumber.from(v.toString());
const minBig = (a, b) => toBig(a) < toBig(b) ? toBig(a) : toBig(b);
const isZero = (v) => toBig(v) === 0n;

const TREASURY = "0xf5579396bFaEd22a14fF43d09eD490ae78784211";
const REWARD = "0x30a6dDfCf8e1Fa11Ce5B2A9745c54123A74e0d15";
const BUCKET_REWARDS = 1;

const TOKENS = {
  TSLA: "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E",
  AMZN: "0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02",
  NFLX: "0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93",
  PLTR: "0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0",
  AMD:  "0x71178BAc73cBeb415514eB542a8995b82669778d",
};

const TREASURY_ABI = [
  "function owner() view returns (address)",
  "function paused() view returns (bool)",
  "function rewardDistributor() view returns (address)",
  "function bucketBalance(address token,uint8 bucket) view returns (uint256)",
  "function distributionThreshold(address token) view returns (uint256)",
  "function canDistribute(address token) view returns (bool)",
  "function setDistributionThreshold(address token,uint256 threshold)",
  "function withdrawBucket(address token,uint8 bucket,address to,uint256 amount)"
];

const REWARD_ABI = [
  "function owner() view returns (address)",
  "function feeTreasury() view returns (address)",
  "function paused() view returns (bool)",
  "function currentWeek() view returns (uint256)",
  "function tokenConfig(address token) view returns (bool enabled,uint256 absoluteWeeklyCap)",
  "function setTokenConfig(address token,bool enabled,uint256 absoluteWeeklyCap)",
  "function availableUnallocated(address token) view returns (uint256)",
  "function fundWeek(address token,uint256 week,uint256 amount)",
  "function setAllocation(address user,address token,uint256 week,uint256 amount)",
  "function allocation(address user,address token,uint256 week) view returns (uint256)",
  "function claimed(address user,address token,uint256 week) view returns (uint256)",
  "function claimable(address user,address token,uint256 week) view returns (uint256)",
  "function claim(address token,uint256 week)",
  "function weekFunded(address token,uint256 week) view returns (uint256)",
  "function weekClaimedTotal(address token,uint256 week) view returns (uint256)",
  "function tokenTotalFunded(address token) view returns (uint256)",
  "function tokenTotalClaimed(address token) view returns (uint256)"
];

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)"
];

function same(a, b) {
  return String(a).toLowerCase() === String(b).toLowerCase();
}

async function waitTx(label, tx) {
  console.log(`${label}: ${tx.hash}`);
  const rc = await tx.wait();
  console.log(`${label} confirmed in block ${rc.blockNumber}`);
}

async function runOne(sym) {
  const tokenAddr = TOKENS[sym];
  if (!tokenAddr) throw new Error(`Unknown token symbol: ${sym}`);

  const treasury = new ethers.Contract(TREASURY, TREASURY_ABI, wallet);
  const reward = new ethers.Contract(REWARD, REWARD_ABI, wallet);
  const token = new ethers.Contract(tokenAddr, ERC20_ABI, wallet);

  const decimals = await token.decimals();
  const week = await reward.currentWeek();

  const linkedReward = await treasury.rewardDistributor();
  const linkedTreasury = await reward.feeTreasury();
  if (!same(linkedReward, REWARD)) throw new Error("Treasury rewardDistributor mismatch");
  if (!same(linkedTreasury, TREASURY)) throw new Error("Reward feeTreasury mismatch");

  const treasuryPaused = await treasury.paused();
  const rewardPaused = await reward.paused();
  if (treasuryPaused) throw new Error("Treasury paused");
  if (rewardPaused) throw new Error("RewardDistributor paused");

  const bucket = await treasury.bucketBalance(tokenAddr, BUCKET_REWARDS);
  const thresholdNow = await treasury.distributionThreshold(tokenAddr);

  const liveThreshold = parseUnits(process.env.REWARD_LIVE_THRESHOLD || "0.000001", decimals);
  const maxSmoke = parseUnits(process.env.REWARD_SMOKE_AMOUNT || "0.00001", decimals);
  const amount = minBig(bucket, maxSmoke);

  console.log("\n============================================================");
  console.log(`${sym} reward live smoke`);
  console.log("Token              :", tokenAddr);
  console.log("Week               :", week.toString());
  console.log("Treasury bucket    :", formatUnits(bucket, decimals));
  console.log("Old threshold      :", formatUnits(thresholdNow, decimals));
  console.log("Live threshold     :", formatUnits(liveThreshold, decimals));
  console.log("Smoke fund amount  :", formatUnits(amount, decimals));

  if (isZero(bucket)) {
    console.log(`SKIP ${sym}: rewards bucket kosong`);
    return;
  }

  if (isZero(amount)) {
    console.log(`SKIP ${sym}: smoke amount terlalu kecil`);
    return;
  }

  if (toBig(bucket) < toBig(liveThreshold)) {
    console.log(`SKIP ${sym}: bucket masih di bawah live threshold`);
    return;
  }

  if (toBig(thresholdNow) !== toBig(liveThreshold)) {
    await waitTx(
      `setDistributionThreshold ${sym}`,
      await treasury.setDistributionThreshold(tokenAddr, liveThreshold)
    );
  }

  const canDist = await treasury.canDistribute(tokenAddr);
  if (!canDist) throw new Error(`${sym}: canDistribute masih false`);

  await waitTx(
    `withdrawBucket rewards ${sym}`,
    await treasury.withdrawBucket(tokenAddr, BUCKET_REWARDS, REWARD, fromBig(amount))
  );

  const available = await reward.availableUnallocated(tokenAddr);
  console.log("Reward available   :", formatUnits(available, decimals));

  const claimCap = amount * 500n / 10000n; // 5% relative cap
  if (claimCap === 0n) throw new Error(`${sym}: claim cap became zero`);

  const cfg = await reward.tokenConfig(tokenAddr);
  const enabled = Array.isArray(cfg) ? cfg[0] : cfg.enabled;
  const oldCap = Array.isArray(cfg) ? cfg[1] : cfg.absoluteWeeklyCap;

  console.log("Reward enabled old :", enabled);
  console.log("Old absolute cap   :", formatUnits(oldCap, decimals));
  console.log("New absolute cap   :", formatUnits(amount, decimals));

  if (!enabled || toBig(oldCap) < amount) {
    await waitTx(
      `setTokenConfig ${sym}`,
      await reward.setTokenConfig(tokenAddr, true, fromBig(amount))
    );
  }

  await waitTx(
    `fundWeek ${sym}`,
    await reward.fundWeek(tokenAddr, week, fromBig(amount))
  );

  const oldAllocation = await reward.allocation(wallet.address, tokenAddr, week);
  const newAllocation = toBig(oldAllocation) + claimCap;

  await waitTx(
    `setAllocation ${sym}`,
    await reward.setAllocation(wallet.address, tokenAddr, week, fromBig(newAllocation))
  );

  const claimable = await reward.claimable(wallet.address, tokenAddr, week);
  console.log("Claimable          :", formatUnits(claimable, decimals));

  if (!isZero(claimable)) {
    await waitTx(
      `claim ${sym}`,
      await reward.claim(tokenAddr, week)
    );
  } else {
    console.log(`SKIP claim ${sym}: claimable zero`);
  }

  const rewardBal = await token.balanceOf(REWARD);
  const walletBal = await token.balanceOf(wallet.address);
  const weekFunded = await reward.weekFunded(tokenAddr, week);
  const weekClaimed = await reward.weekClaimedTotal(tokenAddr, week);
  const totalFunded = await reward.tokenTotalFunded(tokenAddr);
  const totalClaimed = await reward.tokenTotalClaimed(tokenAddr);

  console.log("\nFinal:");
  console.log("RewardDistributor balance:", formatUnits(rewardBal, decimals));
  console.log("Wallet balance           :", formatUnits(walletBal, decimals));
  console.log("Week funded              :", formatUnits(weekFunded, decimals));
  console.log("Week claimed             :", formatUnits(weekClaimed, decimals));
  console.log("Total funded             :", formatUnits(totalFunded, decimals));
  console.log("Total claimed            :", formatUnits(totalClaimed, decimals));
  console.log(`✅ ${sym} reward smoke live complete`);
}

async function main() {
  const arg = (process.argv[2] || "TSLA").toUpperCase();
  const list = arg === "ALL" ? Object.keys(TOKENS) : [arg];

  const net = await provider.getNetwork();
  console.log("Wallet :", wallet.address);
  console.log("Chain  :", net.chainId.toString());
  console.log("Mode   :", arg);

  for (const sym of list) {
    await runOne(sym);
  }

  console.log("\n✅ Done");
}

main().catch((err) => {
  console.error("\n❌ Failed:", err.shortMessage || err.message || err);
  process.exit(1);
});
