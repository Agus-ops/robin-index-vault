import fs from "fs";
import path from "path";
import "dotenv/config";
import { ethers } from "ethers";

const ROOT = process.cwd();
const DEPLOY = JSON.parse(
  fs.readFileSync(path.join(ROOT, "deployments/robinhood-46630.json"), "utf8")
);

function artifact(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "artifacts", `${name}.json`), "utf8"));
}

const BPS = 10000n;

async function waitTx(label, tx) {
  console.log(`TX ${label}: ${tx.hash}`);
  const rc = await tx.wait();
  console.log(`✅ ${label} mined block=${rc.blockNumber} gas=${rc.gasUsed}`);
  return rc;
}

function splitFee(amount) {
  const baseReserve = (amount * 5000n) / BPS;
  const rewards = (amount * 3000n) / BPS;
  const router = (amount * 1500n) / BPS;
  const operator = (amount * 500n) / BPS;
  const allocated = baseReserve + rewards + router + operator;
  const dust = amount - allocated;
  const reserve = baseReserve + dust;
  return { reserve, rewards, router, operator, dust };
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

  const receipt = new ethers.Contract(
    DEPLOY.contracts.receiptToken,
    artifact("ReceiptToken").abi,
    wallet
  );

  const AMZN = ethers.getAddress(DEPLOY.tokens.AMZN.address);

  console.log("Wallet  :", wallet.address);
  console.log("Vault   :", DEPLOY.contracts.vault);
  console.log("Treasury:", DEPLOY.contracts.treasury);
  console.log("Token   : AMZN", AMZN);
  console.log();

  const pendingBefore = await vault.pendingFees(AMZN);
  if (pendingBefore > 0n) {
    console.log("Pre-sweeping existing AMZN pending fee:", pendingBefore.toString(), "wei");
    await waitTx("Vault.sweepFees(AMZN pre)", await vault.sweepFees(AMZN));
  }

  const userBal = await vault.userBalances(wallet.address, AMZN);
  if (userBal < 1000000n) {
    throw new Error("Need tiny AMZN vault balance for dust test");
  }

  let selectedAmount = 0n;
  let selectedFee = 0n;
  let selectedReturned = 0n;
  let selectedBurn = 0n;
  let selectedSplit = null;

  for (let i = 1n; i <= 100000n; i++) {
    const preview = await vault.previewWithdraw(wallet.address, AMZN, i);
    const fee = preview[0];
    if (fee === 0n) continue;

    const split = splitFee(fee);
    if (split.dust > 0n) {
      selectedAmount = i;
      selectedFee = fee;
      selectedReturned = preview[1];
      selectedBurn = preview[2];
      selectedSplit = split;
      break;
    }
  }

  if (selectedAmount === 0n) {
    throw new Error("Could not find dust-producing tiny withdraw amount");
  }

  console.log("Selected tiny withdraw:");
  console.log("amount wei   :", selectedAmount.toString());
  console.log("fee wei      :", selectedFee.toString());
  console.log("returned wei :", selectedReturned.toString());
  console.log("burn rINDEX wei:", selectedBurn.toString());
  console.log();
  console.log("Expected split:");
  console.log("reserve wei :", selectedSplit.reserve.toString());
  console.log("rewards wei :", selectedSplit.rewards.toString());
  console.log("router wei  :", selectedSplit.router.toString());
  console.log("operator wei:", selectedSplit.operator.toString());
  console.log("dust wei    :", selectedSplit.dust.toString());
  console.log();

  const bucketsBefore = await treasury.getBuckets(AMZN);
  const rBefore = await receipt.balanceOf(wallet.address);

  await waitTx(
    "Vault.withdraw(AMZN tiny dust)",
    await vault.withdraw(AMZN, selectedAmount)
  );

  const pendingAfterWithdraw = await vault.pendingFees(AMZN);
  console.log("Pending after tiny withdraw:", pendingAfterWithdraw.toString(), "wei");

  if (pendingAfterWithdraw !== selectedFee) {
    throw new Error("Pending fee after withdraw does not equal selected fee");
  }

  await waitTx("Vault.sweepFees(AMZN dust)", await vault.sweepFees(AMZN));

  const bucketsAfter = await treasury.getBuckets(AMZN);
  const rAfter = await receipt.balanceOf(wallet.address);

  const incReserve = bucketsAfter[0] - bucketsBefore[0];
  const incRewards = bucketsAfter[1] - bucketsBefore[1];
  const incRouter = bucketsAfter[2] - bucketsBefore[2];
  const incOperator = bucketsAfter[3] - bucketsBefore[3];
  const incReceived = bucketsAfter[4] - bucketsBefore[4];

  console.log();
  console.log("Actual bucket increments:");
  console.log("reserve wei :", incReserve.toString());
  console.log("rewards wei :", incRewards.toString());
  console.log("router wei  :", incRouter.toString());
  console.log("operator wei:", incOperator.toString());
  console.log("received wei:", incReceived.toString());
  console.log();

  let ok = true;

  if (incReserve !== selectedSplit.reserve) ok = false;
  if (incRewards !== selectedSplit.rewards) ok = false;
  if (incRouter !== selectedSplit.router) ok = false;
  if (incOperator !== selectedSplit.operator) ok = false;
  if (incReceived !== selectedFee) ok = false;

  console.log("rINDEX before:", ethers.formatUnits(rBefore, 18));
  console.log("rINDEX after :", ethers.formatUnits(rAfter, 18));

  if (!ok) {
    throw new Error("Dust split mismatch");
  }

  console.log();
  console.log("✅ Dust split test passed");
  console.log("✅ Rounding dust was allocated to reserve");
}

main().catch((err) => {
  console.error();
  console.error("❌ Dust split test failed:");
  console.error(err.shortMessage || err.message || err);
  process.exit(1);
});
