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

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.ROBIN_RPC);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const vault = new ethers.Contract(
    DEPLOY.contracts.vault,
    artifact("RobinIndexVault").abi,
    wallet
  );

  const AMZN = ethers.getAddress(DEPLOY.tokens.AMZN.address);

  console.log("Wallet:", wallet.address);
  console.log("Vault :", DEPLOY.contracts.vault);
  console.log("Token : AMZN", AMZN);
  console.log();

  let failures = 0;

  const pausedStart = await vault.paused();
  console.log("Paused at start:", pausedStart);

  if (pausedStart) {
    console.log("Vault already paused, unpausing first...");
    await waitTx("Vault.unpause()", await vault.unpause());
  }

  const userBal = await vault.userBalances(wallet.address, AMZN);
  console.log("User AMZN vault balance:", ethers.formatUnits(userBal, 18));

  if (userBal < 1000000n) {
    throw new Error("Need tiny AMZN vault balance for pause-full test");
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

  console.log("Tiny withdraw amount wei:", selectedAmount.toString());
  console.log("Expected fee wei       :", selectedFee.toString());
  console.log();

  const pendingBefore = await vault.pendingFees(AMZN);

  if (pendingBefore > 0n) {
    console.log("Pre-sweeping existing pending AMZN fee:", pendingBefore.toString(), "wei");
    await waitTx("Vault.sweepFees(AMZN pre)", await vault.sweepFees(AMZN));
  }

  console.log("Creating tiny pending fee before pause...");
  await waitTx(
    "Vault.withdraw(AMZN tiny pre-pause)",
    await vault.withdraw(AMZN, selectedAmount)
  );

  const pendingForPause = await vault.pendingFees(AMZN);
  console.log("Pending fee before pause:", pendingForPause.toString(), "wei");

  if (pendingForPause === 0n) {
    throw new Error("Pending fee was not created before pause");
  }

  try {
    await waitTx("Vault.pause()", await vault.pause());

    const pausedNow = await vault.paused();
    console.log("Paused now:", pausedNow);

    if (!pausedNow) {
      console.log("❌ Vault did not enter paused state");
      failures++;
    }

    const okDeposit = await expectRevert(
      "deposit while paused",
      async () => vault.deposit(AMZN, 1n)
    );
    if (!okDeposit) failures++;

    const okDaily = await expectRevert(
      "dailyRebalanceCheck while paused",
      async () => vault.dailyRebalanceCheck("PAUSE_FULL_TEST")
    );
    if (!okDaily) failures++;

    console.log();
    console.log("Testing sweepFees while paused...");
    await waitTx("Vault.sweepFees(AMZN while paused)", await vault.sweepFees(AMZN));

    const pendingAfterPausedSweep = await vault.pendingFees(AMZN);
    console.log("Pending after paused sweep:", pendingAfterPausedSweep.toString(), "wei");

    if (pendingAfterPausedSweep !== 0n) {
      console.log("❌ sweepFees while paused did not clear pending fee");
      failures++;
    } else {
      console.log("✅ sweepFees while paused succeeded and cleared pending fee");
    }

    console.log();
    console.log("Testing withdraw while paused...");
    await waitTx(
      "Vault.withdraw(AMZN tiny while paused)",
      await vault.withdraw(AMZN, selectedAmount)
    );

    console.log("✅ withdraw while paused succeeded");
  } finally {
    const stillPaused = await vault.paused();

    if (stillPaused) {
      console.log();
      console.log("Restoring vault to unpaused state...");
      await waitTx("Vault.unpause()", await vault.unpause());
    }
  }

  const pausedEnd = await vault.paused();
  console.log();
  console.log("Paused at end:", pausedEnd);

  if (pausedEnd) {
    console.log("❌ Vault still paused at end");
    failures++;
  }

  const pendingAfter = await vault.pendingFees(AMZN);
  console.log("Pending after paused withdraw:", pendingAfter.toString(), "wei");

  if (pendingAfter > 0n) {
    await waitTx("Vault.sweepFees(AMZN cleanup)", await vault.sweepFees(AMZN));
  }

  const pendingFinal = await vault.pendingFees(AMZN);
  console.log("Pending final:", pendingFinal.toString(), "wei");

  if (pendingFinal !== 0n) {
    console.log("❌ Pending fee not cleaned up");
    failures++;
  }

  if (failures > 0) {
    throw new Error(`Pause-full test finished with ${failures} failure(s)`);
  }

  console.log();
  console.log("✅ Pause-full test passed");
  console.log("✅ pause blocks deposit/dailyRebalanceCheck");
  console.log("✅ pause allows withdraw");
  console.log("✅ pause allows fee sweep without breaking accounting");
}

main().catch((err) => {
  console.error();
  console.error("❌ Pause-full test failed:");
  console.error(err.shortMessage || err.message || err);
  process.exit(1);
});
