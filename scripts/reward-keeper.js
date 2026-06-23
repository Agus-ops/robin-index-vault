import fs from "fs";
import path from "path";
import "dotenv/config";
import { ethers } from "ethers";

const ROOT = process.cwd();
const DEPLOY = JSON.parse(
  fs.readFileSync(path.join(ROOT, "deployments/robinhood-46630.json"), "utf8")
);

function artifact(name) {
  const candidates = [
    path.join(ROOT, "artifacts", "contracts", `${name}_v0.8.1.sol`, `${name}.json`),
    path.join(ROOT, "artifacts", "contracts", `${name}.sol`, `${name}.json`),
    path.join(ROOT, "artifacts", `${name}.json`),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  }
  throw new Error(`artifact not found for ${name}, tried: ${candidates.join(", ")}`);
}

const STOCKS = ["TSLA", "AMZN", "NFLX", "PLTR", "AMD"];
const EXEC = process.env.EXEC === "1";

async function waitTx(label, tx) {
  console.log(`TX ${label}: ${tx.hash}`);
  const rc = await tx.wait();
  console.log(`✅ ${label} mined block=${rc.blockNumber} gas=${rc.gasUsed}`);
  return rc;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.ROBIN_RPC);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const treasury = new ethers.Contract(
    DEPLOY.contracts.treasury,
    artifact("FeeTreasury").abi,
    wallet
  );

  const distributor = new ethers.Contract(
    DEPLOY.contracts.rewardDistributor,
    artifact("RewardDistributor").abi,
    wallet
  );

  console.log("========================================");
  console.log(" Robin Index Vault Reward Keeper");
  console.log("========================================");
  console.log("Mode     :", EXEC ? "EXECUTE" : "DRY-RUN");
  console.log("Treasury :", DEPLOY.contracts.treasury);
  console.log("Distributor:", DEPLOY.contracts.rewardDistributor);
  console.log();

  const currentWeek = await distributor.currentWeek();

  for (const symbol of STOCKS) {
    console.log(`================ ${symbol} ================`);
    const tokenAddr = ethers.getAddress(DEPLOY.tokens[symbol].address);

    const canDist = await treasury.canDistribute(tokenAddr);
    console.log("canDistribute:", canDist);

    if (!canDist) {
      console.log("Reward action: skip, below threshold");
      continue;
    }

    const buckets = await treasury.getBuckets(tokenAddr);
    const rewardAmount = buckets[1]; // rewards bucket
    console.log("Rewards bucket:", ethers.formatUnits(rewardAmount, DEPLOY.tokens[symbol].decimals), symbol);

    if (rewardAmount === 0n) {
      console.log("Reward action: skip, empty bucket");
      continue;
    }

    // Tarik reward ke distributor
    if (EXEC) {
      await waitTx(
        `Treasury.withdrawBucket(${symbol} rewards)`,
        await treasury.withdrawBucket(tokenAddr, 1, DEPLOY.contracts.rewardDistributor, rewardAmount)
      );
    } else {
      console.log(`DRY-RUN: would withdraw ${ethers.formatUnits(rewardAmount, DEPLOY.tokens[symbol].decimals)} ${symbol} rewards to distributor`);
    }

    // Fund week
    const available = await distributor.availableUnallocated(tokenAddr);
    console.log("Available unallocated:", ethers.formatUnits(available, DEPLOY.tokens[symbol].decimals), symbol);

    if (available > 0n && EXEC) {
      await waitTx(
        `Distributor.fundWeek(${symbol} week ${currentWeek})`,
        await distributor.fundWeek(tokenAddr, currentWeek, available)
      );
      console.log(`✅ Funded week ${currentWeek} with ${ethers.formatUnits(available, DEPLOY.tokens[symbol].decimals)} ${symbol}`);
    } else if (available > 0n) {
      console.log(`DRY-RUN: would fund week ${currentWeek} with ${ethers.formatUnits(available, DEPLOY.tokens[symbol].decimals)} ${symbol}`);
    } else {
      console.log("Fund action: skip, nothing unallocated");
    }

    console.log();
  }

  console.log("✅ Reward keeper complete");
}

main().catch((err) => {
  console.error("\n❌ Reward keeper failed:");
  console.error(err.shortMessage || err.message || err);
  process.exit(1);
});
