import { loadArtifact } from "./lib/artifact-loader.mjs";
import fs from "fs";
import path from "path";
import "dotenv/config";
import { ethers } from "ethers";

const ROOT = process.cwd();
const DEPLOY = JSON.parse(
  fs.readFileSync(path.join(ROOT, "deployments/robinhood-46630.json"), "utf8")
);

function artifact(name) {
  return loadArtifact(ROOT, name);
}

async function waitTx(label, tx) {
  console.log(`TX ${label}: ${tx.hash}`);
  const rc = await tx.wait();
  console.log(`✅ ${label} mined block=${rc.blockNumber} gas=${rc.gasUsed}`);
  return rc;
}

async function expectStaticRevert(label, fn) {
  try {
    await fn();
    console.log(`❌ ${label}: expected revert, but staticCall succeeded`);
    return false;
  } catch (e) {
    const msg = e.shortMessage || e.message || String(e);
    console.log(`✅ ${label}: reverted as expected`);
    console.log(`   reason: ${msg.slice(0, 180)}`);
    return true;
  }
}

function fmtTime(seconds) {
  const s = Number(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${h}h ${m}m ${r}s`;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.ROBIN_RPC);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const vaultArtifact = artifact("RobinIndexVault");

  const vault = new ethers.Contract(
    DEPLOY.contracts.vault,
    vaultArtifact.abi,
    wallet
  );

  const iface = new ethers.Interface(vaultArtifact.abi);

  console.log("Wallet:", wallet.address);
  console.log("Vault :", DEPLOY.contracts.vault);
  console.log();

  if (await vault.paused()) {
    console.log("Vault is paused at start, unpausing first...");
    await waitTx("Vault.unpause()", await vault.unpause());
  }

  const cooldown = await vault.DAILY_REBALANCE_COOLDOWN();
  const lastBefore = await vault.lastRebalanceAt(wallet.address);
  const latestBlock = await provider.getBlock("latest");
  const nowTs = BigInt(latestBlock.timestamp);

  const age = lastBefore === 0n ? cooldown + 1n : nowTs - lastBefore;
  const remaining = age >= cooldown ? 0n : cooldown - age;

  console.log("Cooldown seconds:", cooldown.toString(), `(${fmtTime(cooldown)})`);
  console.log("lastRebalanceAt:", lastBefore.toString());
  console.log("block timestamp:", nowTs.toString());
  console.log("age            :", age.toString(), `(${fmtTime(age)})`);
  console.log("remaining      :", remaining.toString(), `(${fmtTime(remaining)})`);
  console.log();

  const strategy = `COOLDOWN_TEST_${Date.now()}`;

  if (remaining > 0n) {
    console.log("Cooldown is already active. Testing revert only...");

    const ok = await expectStaticRevert(
      "dailyRebalanceCheck while cooldown active",
      async () => vault.dailyRebalanceCheck.staticCall(strategy)
    );

    if (!ok) {
      throw new Error("Cooldown active but dailyRebalanceCheck did not revert");
    }

    console.log();
    console.log("✅ Daily cooldown test passed");
    console.log("✅ cooldown was already active and call reverted");
    return;
  }

  console.log("Cooldown is clear. Calling dailyRebalanceCheck...");
  const rc = await waitTx(
    "Vault.dailyRebalanceCheck",
    await vault.dailyRebalanceCheck(strategy)
  );

  const parsedEvents = [];

  for (const log of rc.logs) {
    if (log.address.toLowerCase() !== DEPLOY.contracts.vault.toLowerCase()) continue;

    try {
      const parsed = iface.parseLog(log);
      parsedEvents.push(parsed);
    } catch (_) {
      // ignore non-matching logs
    }
  }

  console.log();
  console.log("Parsed Vault events:");

  for (const ev of parsedEvents) {
    const args = [];
    for (const [k, v] of Object.entries(ev.args)) {
      if (!Number.isNaN(Number(k))) continue;
      args.push(`${k}=${v.toString()}`);
    }
    console.log(`- ${ev.name}${args.length ? " | " + args.join(", ") : ""}`);
  }

  if (parsedEvents.length === 0) {
    throw new Error("dailyRebalanceCheck tx emitted no parsable Vault events");
  }

  const lastAfter = await vault.lastRebalanceAt(wallet.address);
  console.log();
  console.log("lastRebalanceAt after:", lastAfter.toString());

  if (lastAfter <= lastBefore) {
    throw new Error("lastRebalanceAt did not increase after dailyRebalanceCheck");
  }

  console.log("✅ lastRebalanceAt updated");

  const okSecond = await expectStaticRevert(
    "second dailyRebalanceCheck inside cooldown",
    async () => vault.dailyRebalanceCheck.staticCall(`${strategy}_SECOND`)
  );

  if (!okSecond) {
    throw new Error("Second dailyRebalanceCheck did not revert inside cooldown");
  }

  console.log();
  console.log("✅ Daily cooldown test passed");
  console.log("✅ first call emitted event and updated timestamp");
  console.log("✅ second call reverted due cooldown");
}

main().catch((err) => {
  console.error();
  console.error("❌ Daily cooldown test failed:");
  console.error(err.shortMessage || err.message || err);
  process.exit(1);
});
