import fs from "fs";
import path from "path";
import "dotenv/config";
import { ethers } from "ethers";

const ROOT = process.cwd();
const DEPLOY = JSON.parse(
  fs.readFileSync(path.join(ROOT, "deployments/robinhood-46630.json"), "utf8")
);

function artifact(name) {
  return JSON.parse(
    fs.readFileSync(path.join(ROOT, "artifacts", `${name}.json`), "utf8")
  );
}

const STOCKS = ["TSLA", "AMZN", "NFLX", "PLTR", "AMD"];
const EXEC = process.env.EXEC === "1";
const USERS = (process.env.WATCH_USERS || "").split(",").map(s => s.trim()).filter(Boolean);
const CUTOFF_HOURS = 24;

async function waitTx(label, tx) {
  console.log(`TX ${label}: ${tx.hash}`);
  const rc = await tx.wait();
  console.log(`✅ ${label} mined block=${rc.blockNumber} gas=${rc.gasUsed}`);
  return rc;
}

async function main() {
  if (USERS.length === 0) {
    console.log("No WATCH_USERS configured. Skipping auto-allocate.");
    return;
  }

  const provider = new ethers.JsonRpcProvider(process.env.ROBIN_RPC);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const distributor = new ethers.Contract(
    DEPLOY.contracts.rewardDistributor,
    artifact("RewardDistributor").abi,
    wallet
  );

  const vault = new ethers.Contract(
    DEPLOY.contracts.vault,
    artifact("RobinIndexVault").abi,
    wallet
  );

  console.log("========================================");
  console.log(" Robin Index Vault Auto Allocate");
  console.log("========================================");
  console.log("Mode     :", EXEC ? "EXECUTE" : "DRY-RUN");
  console.log("Users    :", USERS.join(", "));
  console.log("Cutoff   :", CUTOFF_HOURS, "hours before epoch start");
  console.log();

  const currentWeek = await distributor.currentWeek();
  const epochStart = currentWeek * 7n * 86400n;
  const cutoffTimestamp = epochStart - BigInt(CUTOFF_HOURS) * 3600n;

  console.log("Current week:", currentWeek.toString());
  console.log("Epoch start :", new Date(Number(epochStart) * 1000).toISOString());
  console.log("Cutoff time :", new Date(Number(cutoffTimestamp) * 1000).toISOString());
  console.log();

  // Pre‑fetch fee config (satu kali)
  const feeConfig = await vault.feeConfig();
  const depositFeeBps = feeConfig[0];

  // Pre‑fetch user eligibility (satu kali per user)
  const eligibleUsers = [];
  for (const user of USERS) {
    const hasDeposited = await vault.hasEverDeposited(user);
    if (!hasDeposited) {
      console.log(`  ${user}: hasNeverDeposited, skip`);
      continue;
    }
    const lastDeposit = await vault.lastDepositAt(user);
    if (lastDeposit > cutoffTimestamp) {
      console.log(`  ${user}: deposit too recent, skip`);
      continue;
    }
    eligibleUsers.push(user);
  }

  if (eligibleUsers.length === 0) {
    console.log("No eligible users after cutoff check");
    return;
  }

  console.log("Eligible users:", eligibleUsers.join(", "));
  console.log();

  for (const symbol of STOCKS) {
    console.log(`================ ${symbol} ================`);
    const tokenAddr = ethers.getAddress(DEPLOY.tokens[symbol].address);
    const decimals = DEPLOY.tokens[symbol].decimals;

    const weekFunded = await distributor.weekFunded(tokenAddr, currentWeek);
    console.log("Week funded:", ethers.formatUnits(weekFunded, decimals), symbol);

    if (weekFunded === 0n) {
      console.log("Skip: weekFunded is 0");
      continue;
    }

    // Kumpulkan data biaya user (dalam loop token)
    const eligible = [];
    let totalFees = 0n;

    for (const user of eligibleUsers) {
      const totalDeposited = await vault.userTotalDeposited(user, tokenAddr);
      const userFees = (totalDeposited * BigInt(depositFeeBps)) / 10000n;

      if (userFees > 0n) {
        eligible.push({ user, userFees });
        totalFees += userFees;
      }
    }

    if (eligible.length === 0) {
      console.log("No users with fees for this token");
      continue;
    }

    console.log("Users with fees:", eligible.length);
    console.log("Total fees    :", ethers.formatUnits(totalFees, decimals), symbol);

    const relativeCap = (weekFunded * 500n) / 10000n;
    const tokenConfig = await distributor.tokenConfig(tokenAddr);
    const absoluteCap = tokenConfig[1];

    for (const { user, userFees } of eligible) {
      let allocation = (weekFunded * userFees) / totalFees;

      // Terapkan cap
      if (relativeCap < allocation) allocation = relativeCap;
      if (absoluteCap > 0n && absoluteCap < allocation) allocation = absoluteCap;

      if (allocation === 0n) {
        console.log(`  ${user}: allocation after capping is 0, skip`);
        continue;
      }

      const currentAlloc = await distributor.allocation(user, tokenAddr, currentWeek);
      if (currentAlloc === allocation) {
        console.log(`  ${user}: already set (${ethers.formatUnits(allocation, decimals)}), skip`);
        continue;
      }

      console.log(`  ${user}: ${ethers.formatUnits(allocation, decimals)} ${symbol}`);

      if (EXEC) {
        await waitTx(
          `setAllocation(${symbol}, week ${currentWeek})`,
          await distributor.setAllocation(user, tokenAddr, currentWeek, allocation)
        );
      } else {
        console.log(`    DRY-RUN: would set allocation`);
      }
    }

    console.log();
  }

  console.log("✅ Auto allocate complete");
}

main().catch((err) => {
  console.error("\n❌ Auto allocate failed:");
  console.error(err.shortMessage || err.message || err);
  process.exit(1);
});
