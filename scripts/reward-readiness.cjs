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

const ZERO = "0x0000000000000000000000000000000000000000";

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
  "function isKeeper(address) view returns (bool)",
  "function bucketBalance(address token,uint8 bucket) view returns (uint256)",
  "function distributionThreshold(address token) view returns (uint256)",
  "function canDistribute(address token) view returns (bool)"
];

const REWARD_ABI = [
  "function owner() view returns (address)",
  "function feeTreasury() view returns (address)",
  "function paused() view returns (bool)",
  "function keepers(address) view returns (bool)",
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

async function main() {
  const net = await provider.getNetwork();
  const treasury = new ethers.Contract(TREASURY, TREASURY_ABI, provider);
  const reward = new ethers.Contract(REWARD, REWARD_ABI, provider);

  console.log("========================================");
  console.log(" Robin Index Vault Reward Readiness");
  console.log("========================================");
  console.log("Chain ID          :", net.chainId.toString());
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

  console.log("Core wiring:");
  console.log("Treasury owner            :", treasuryOwner);
  console.log("Reward owner              :", rewardOwner);
  console.log("Treasury paused           :", treasuryPaused);
  console.log("Reward paused             :", rewardPaused);
  console.log("Treasury.rewardDistributor:", linkedReward);
  console.log("Reward.feeTreasury        :", linkedTreasury);
  console.log("Current week              :", week.toString());
  console.log("");

  const ok1 = same(linkedReward, REWARD);
  const ok2 = same(linkedTreasury, TREASURY);
  const ok3 = same(treasuryOwner, rewardOwner);

  console.log(ok1 ? "✅ PASS: Treasury points to RewardDistributor" : "❌ FAIL: Treasury rewardDistributor mismatch");
  console.log(ok2 ? "✅ PASS: RewardDistributor points to Treasury" : "❌ FAIL: RewardDistributor feeTreasury mismatch");
  console.log(ok3 ? "✅ PASS: Treasury/Reward owners match" : "⚠️ WARN: Treasury/Reward owners differ");
  console.log("");

  console.log("Per-token reward state:");
  console.log("------------------------------------------------------------");

  let failures = 0;

  if (!ok1 || !ok2) failures++;

  for (const [sym, addr] of TOKENS) {
    const token = new ethers.Contract(addr, ERC20_ABI, provider);
    const decimals = await token.decimals();

    const bal = await token.balanceOf(REWARD);
    const rewardsBucket = await treasury.bucketBalance(addr, 1);
    const threshold = await treasury.distributionThreshold(addr);
    const canDist = await treasury.canDistribute(addr);
    const [enabled, absoluteWeeklyCap] = await reward.tokenConfig(addr);
    const available = await reward.availableUnallocated(addr);
    const totalFunded = await reward.tokenTotalFunded(addr);
    const totalClaimed = await reward.tokenTotalClaimed(addr);
    const weekFunded = await reward.weekFunded(addr, week);
    const weekClaimed = await reward.weekClaimedTotal(addr, week);

    console.log(`\n${sym}`);
    console.log("Token                 :", addr);
    console.log("Treasury rewards bucket:", formatUnits(rewardsBucket, decimals));
    console.log("Distribution threshold :", formatUnits(threshold, decimals));
    console.log("Can distribute         :", canDist);
    console.log("Reward token balance   :", formatUnits(bal, decimals));
    console.log("Reward enabled         :", enabled);
    console.log("Absolute weekly cap    :", formatUnits(absoluteWeeklyCap, decimals));
    console.log("Available unallocated  :", formatUnits(available, decimals));
    console.log("Total funded           :", formatUnits(totalFunded, decimals));
    console.log("Total claimed          :", formatUnits(totalClaimed, decimals));
    console.log("This week funded       :", formatUnits(weekFunded, decimals));
    console.log("This week claimed      :", formatUnits(weekClaimed, decimals));

    if (!enabled) {
      console.log(`⚠️ WARN: ${sym} reward token not enabled yet`);
    }
  }

  console.log("\n------------------------------------------------------------");
  if (failures === 0) {
    console.log("✅ Reward readiness core wiring passed");
  } else {
    console.log("❌ Reward readiness has blocking wiring issue");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\n❌ Failed:", err.shortMessage || err.message || err);
  process.exit(1);
});
