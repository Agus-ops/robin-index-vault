try { require("dotenv").config(); } catch {}

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const RPC_URL =
  process.env.ROBIN_RPC ||
  process.env.ROBINHOOD_RPC_URL ||
  process.env.RPC_URL ||
  process.env.VITE_ROBINHOOD_RPC_URL;

if (!RPC_URL) throw new Error("Missing RPC env: ROBIN_RPC or RPC_URL");

const isV6 = !!ethers.JsonRpcProvider;
const provider = isV6
  ? new ethers.JsonRpcProvider(RPC_URL)
  : new ethers.providers.JsonRpcProvider(RPC_URL);

const formatUnits = (v, d) =>
  isV6 ? ethers.formatUnits(v, d) : ethers.utils.formatUnits(v, d);

const DEPLOYMENT_FILE = path.join(__dirname, "..", "deployments", "robinhood-46630.json");
const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));

function deepFindAddress(obj, names) {
  const wanted = names.map((x) => x.toLowerCase());

  function walk(x, key = "") {
    if (!x) return null;

    if (typeof x === "string" && /^0x[a-fA-F0-9]{40}$/.test(x)) {
      if (wanted.some((n) => key.toLowerCase().includes(n))) return x;
    }

    if (typeof x === "object") {
      for (const [k, v] of Object.entries(x)) {
        const found = walk(v, k);
        if (found) return found;
      }
    }

    return null;
  }

  return walk(obj);
}

const TREASURY =
  deepFindAddress(deployment, ["treasury", "feeTreasury"]) ||
  "0xf5579396bFaEd22a14fF43d09eD490ae78784211";

const REWARD =
  deepFindAddress(deployment, ["rewardDistributor", "rewards"]) ||
  "0x30a6dDfCf8e1Fa11Ce5B2A9745c54123A74e0d15";

const TOKENS = [
  ["TSLA", "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E"],
  ["AMZN", "0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02"],
  ["NFLX", "0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93"],
  ["PLTR", "0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0"],
  ["AMD",  "0x71178BAc73cBeb415514eB542a8995b82669778d"],
];

const TREASURY_ABI = [
  "function owner() view returns (address)",
  "function paused() view returns (bool)",
  "function rewardDistributor() view returns (address)",
  "function bucketBalance(address token,uint8 bucket) view returns (uint256)",
  "function distributionThreshold(address token) view returns (uint256)",
  "function canDistribute(address token) view returns (bool)"
];

const REWARD_ABI = [
  "function owner() view returns (address)",
  "function feeTreasury() view returns (address)",
  "function paused() view returns (bool)",
  "function currentWeek() view returns (uint256)",
  "function tokenConfig(address token) view returns (bool enabled,uint256 absoluteWeeklyCap)",
  "function availableUnallocated(address token) view returns (uint256)",
  "function tokenTotalFunded(address token) view returns (uint256)",
  "function tokenTotalClaimed(address token) view returns (uint256)",
  "function weekFunded(address token,uint256 week) view returns (uint256)",
  "function weekClaimedTotal(address token,uint256 week) view returns (uint256)"
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

function same(a, b) {
  return String(a).toLowerCase() === String(b).toLowerCase();
}

function isZero(v) {
  return typeof v === "bigint" ? v === 0n : v.isZero();
}

async function main() {
  const treasury = new ethers.Contract(TREASURY, TREASURY_ABI, provider);
  const reward = new ethers.Contract(REWARD, REWARD_ABI, provider);

  let passes = 0;
  let warnings = 0;
  let failures = 0;

  function pass(msg) {
    passes++;
    console.log("✅ PASS:", msg);
  }

  function warn(msg) {
    warnings++;
    console.log("⚠️ WARN:", msg);
  }

  function fail(msg) {
    failures++;
    console.log("❌ FAIL:", msg);
  }

  console.log("Robin Index Vault reward invariant check");
  console.log("Treasury          :", TREASURY);
  console.log("RewardDistributor :", REWARD);
  console.log("");

  const treasuryOwner = await treasury.owner();
  const rewardOwner = await reward.owner();
  const treasuryPaused = await treasury.paused();
  const rewardPaused = await reward.paused();
  const linkedReward = await treasury.rewardDistributor();
  const linkedTreasury = await reward.feeTreasury();
  const week = await reward.currentWeek();

  same(linkedReward, REWARD)
    ? pass("Treasury.rewardDistributor matches deployment")
    : fail("Treasury.rewardDistributor mismatch");

  same(linkedTreasury, TREASURY)
    ? pass("RewardDistributor.feeTreasury matches deployment")
    : fail("RewardDistributor.feeTreasury mismatch");

  same(treasuryOwner, rewardOwner)
    ? pass("Treasury and RewardDistributor owners match")
    : warn("Treasury and RewardDistributor owners differ");

  treasuryPaused === false
    ? pass("Treasury is not paused")
    : fail("Treasury is paused");

  rewardPaused === false
    ? pass("RewardDistributor is not paused")
    : fail("RewardDistributor is paused");

  console.log("\nPer-token reward invariants");
  console.log("------------------------------------------------------------");

  for (const [sym, addr] of TOKENS) {
    const token = new ethers.Contract(addr, ERC20_ABI, provider);
    const decimals = await token.decimals();

    const rewardBal = await token.balanceOf(REWARD);
    const rewardsBucket = await treasury.bucketBalance(addr, 1);
    const threshold = await treasury.distributionThreshold(addr);
    const canDist = await treasury.canDistribute(addr);
    const [enabled, cap] = await reward.tokenConfig(addr);
    const available = await reward.availableUnallocated(addr);
    const totalFunded = await reward.tokenTotalFunded(addr);
    const totalClaimed = await reward.tokenTotalClaimed(addr);
    const weekFunded = await reward.weekFunded(addr, week);
    const weekClaimed = await reward.weekClaimedTotal(addr, week);

    console.log(`\n${sym}`);
    console.log("rewardsBucket :", formatUnits(rewardsBucket, decimals));
    console.log("threshold     :", formatUnits(threshold, decimals));
    console.log("canDistribute :", canDist);
    console.log("rewardBalance :", formatUnits(rewardBal, decimals));
    console.log("enabled       :", enabled);
    console.log("cap           :", formatUnits(cap, decimals));
    console.log("available     :", formatUnits(available, decimals));
    console.log("totalFunded   :", formatUnits(totalFunded, decimals));
    console.log("totalClaimed  :", formatUnits(totalClaimed, decimals));
    console.log("weekFunded    :", formatUnits(weekFunded, decimals));
    console.log("weekClaimed   :", formatUnits(weekClaimed, decimals));

    if (!enabled && isZero(rewardBal) && isZero(totalFunded) && isZero(totalClaimed)) {
      pass(`${sym} reward inactive state is clean`);
    } else if (enabled && !isZero(cap)) {
      pass(`${sym} reward enabled with non-zero cap`);
    } else {
      warn(`${sym} reward config is partial; review before funding`);
    }

    if (canDist && isZero(rewardsBucket)) {
      fail(`${sym} canDistribute true but rewards bucket is zero`);
    } else {
      pass(`${sym} treasury distribution flag is consistent`);
    }

    if (isZero(totalFunded) && !isZero(totalClaimed)) {
      fail(`${sym} claimed exists without funded amount`);
    } else {
      pass(`${sym} funded/claimed totals are consistent`);
    }

    if (isZero(weekFunded) && !isZero(weekClaimed)) {
      fail(`${sym} weekly claimed exists without weekly funded amount`);
    } else {
      pass(`${sym} weekly funded/claimed values are consistent`);
    }
  }

  console.log("\n------------------------------------------------------------");
  console.log("Passes  :", passes);
  console.log("Warnings:", warnings);
  console.log("Failures:", failures);

  if (failures > 0) {
    console.log("\n❌ Reward invariant check failed");
    process.exit(1);
  }

  console.log("\n✅ Reward invariant check passed");
}

main().catch((err) => {
  console.error("\n❌ Failed:", err.shortMessage || err.message || err);
  process.exit(1);
});
