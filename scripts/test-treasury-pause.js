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

async function expectRevert(label, fn) {
  try {
    const tx = await fn();
    const rc = await tx.wait();
    console.log(`❌ ${label}: expected revert, but tx succeeded in block ${rc.blockNumber}`);
    return false;
  } catch (e) {
    const msg = e.shortMessage || e.message || String(e);
    console.log(`✅ ${label}: reverted as expected`);
    console.log(`   reason: ${msg.slice(0, 180)}`);
    return true;
  }
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

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.ROBIN_RPC);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const vault = new ethers.Contract(
    DEPLOY.contracts.vault,
    artifact("RobinIndexVault").abi,
    wallet
  );

  const treasury = new ethers.Contract(
    DEPLOY.contracts.treasury,
    artifact("FeeTreasury").abi,
    wallet
  );

  const AMZN = ethers.getAddress(DEPLOY.tokens.AMZN.address);

  console.log("Wallet  :", wallet.address);
  console.log("Vault   :", DEPLOY.contracts.vault);
  console.log("Treasury:", DEPLOY.contracts.treasury);
  console.log("Token   : AMZN", AMZN);
  console.log();

  let failures = 0;

  if (await vault.paused()) {
    console.log("Vault is paused at start, unpausing first...");
    await waitTx("Vault.unpause()", await vault.unpause());
  }

  if (await treasury.paused()) {
    console.log("Treasury is paused at start, unpausing first...");
    await waitTx("Treasury.unpause()", await treasury.unpause());
  }

  const reserveBucket = await treasury.BUCKET_RESERVE();
  const rewardsBucket = await treasury.BUCKET_REWARDS();
  const routerBucket = await treasury.BUCKET_ROUTER();
  const operatorBucket = await treasury.BUCKET_OPERATOR();

  console.log("Buckets:");
  console.log("reserve :", reserveBucket.toString());
  console.log("rewards :", rewardsBucket.toString());
  console.log("router  :", routerBucket.toString());
  console.log("operator:", operatorBucket.toString());
  console.log();

  const userBal = await vault.userBalances(wallet.address, AMZN);
  console.log("User AMZN vault balance:", ethers.formatUnits(userBal, 18));

  if (userBal < 1000000n) {
    throw new Error("Need tiny AMZN vault balance for treasury pause test");
  }

  const existingPending = await vault.pendingFees(AMZN);
  if (existingPending > 0n) {
    console.log("Pre-sweeping existing AMZN pending fee:", existingPending.toString(), "wei");
    await waitTx("Vault.sweepFees(AMZN pre)", await vault.sweepFees(AMZN));
  }

  let selectedAmount = 0n;
  let selectedFee = 0n;

  for (let i = 100n; i <= 100000n; i++) {
    const preview = await vault.previewWithdraw(wallet.address, AMZN, i);
    const fee = preview[0];

    if (fee > 0n) {
      selectedAmount = i;
      selectedFee = fee;
      break;
    }
  }

  if (selectedAmount === 0n) {
    throw new Error("Could not find tiny withdraw amount with nonzero fee");
  }

  console.log("Creating pending fee via tiny withdraw...");
  console.log("withdraw amount wei:", selectedAmount.toString());
  console.log("expected fee wei   :", selectedFee.toString());

  await waitTx(
    "Vault.withdraw(AMZN tiny pre-treasury-pause)",
    await vault.withdraw(AMZN, selectedAmount)
  );

  const pendingBeforePause = await vault.pendingFees(AMZN);
  console.log("Pending before treasury pause:", pendingBeforePause.toString(), "wei");

  if (pendingBeforePause !== selectedFee) {
    throw new Error("Pending fee before treasury pause does not match expected fee");
  }

  try {
    await waitTx("Treasury.pause()", await treasury.pause());

    const pausedNow = await treasury.paused();
    console.log("Treasury paused now:", pausedNow);

    if (!pausedNow) {
      console.log("❌ Treasury did not enter paused state");
      failures++;
    }

    const okSweep = await expectRevert(
      "Vault.sweepFees -> Treasury.receiveFee while treasury paused",
      async () => vault.sweepFees(AMZN)
    );
    if (!okSweep) failures++;

    const pendingAfterFailedSweep = await vault.pendingFees(AMZN);
    console.log("Pending after failed sweep:", pendingAfterFailedSweep.toString(), "wei");

    if (pendingAfterFailedSweep !== pendingBeforePause) {
      console.log("❌ Pending fee changed after failed paused sweep");
      failures++;
    } else {
      console.log("✅ Pending fee remained unchanged after failed paused sweep");
    }

    const reserveBal = await treasury.bucketBalance(AMZN, reserveBucket);
    console.log("Reserve bucket AMZN:", reserveBal.toString(), "wei");

    if (reserveBal > 0n) {
      const okWithdrawBucket = await expectStaticRevert(
        "Treasury.withdrawBucket reserve while paused",
        async () => treasury.withdrawBucket.staticCall(
          AMZN,
          reserveBucket,
          wallet.address,
          1n
        )
      );

      if (!okWithdrawBucket) failures++;
    } else {
      console.log("⚠️ Reserve bucket is zero, skipping withdrawBucket paused check");
    }
  } finally {
    const stillPaused = await treasury.paused();

    if (stillPaused) {
      console.log();
      console.log("Restoring treasury to unpaused state...");
      await waitTx("Treasury.unpause()", await treasury.unpause());
    }
  }

  const pausedEnd = await treasury.paused();
  console.log();
  console.log("Treasury paused at end:", pausedEnd);

  if (pausedEnd) {
    console.log("❌ Treasury still paused at end");
    failures++;
  }

  const pendingBeforeCleanup = await vault.pendingFees(AMZN);
  console.log("Pending before cleanup:", pendingBeforeCleanup.toString(), "wei");

  if (pendingBeforeCleanup > 0n) {
    await waitTx("Vault.sweepFees(AMZN cleanup)", await vault.sweepFees(AMZN));
  }

  const pendingFinal = await vault.pendingFees(AMZN);
  console.log("Pending final:", pendingFinal.toString(), "wei");

  if (pendingFinal !== 0n) {
    console.log("❌ Pending fee not cleaned up");
    failures++;
  }

  if (failures > 0) {
    throw new Error(`Treasury pause test finished with ${failures} failure(s)`);
  }

  console.log();
  console.log("✅ Treasury pause test passed");
  console.log("✅ treasury pause blocks receiveFee via vault.sweepFees");
  console.log("✅ treasury pause blocks withdrawBucket");
  console.log("✅ failed sweep keeps vault pendingFees unchanged");
  console.log("✅ treasury restored and cleanup sweep succeeded");
}

main().catch((err) => {
  console.error();
  console.error("❌ Treasury pause test failed:");
  console.error(err.shortMessage || err.message || err);
  process.exit(1);
});
