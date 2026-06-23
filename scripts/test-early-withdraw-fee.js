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

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)"
];

const BPS = 10000n;

async function waitTx(label, tx) {
  console.log(`TX ${label}: ${tx.hash}`);
  const rc = await tx.wait();
  console.log(`✅ ${label} mined block=${rc.blockNumber} gas=${rc.gasUsed}`);
  return rc;
}

function bps(amount, feeBps) {
  return (amount * BigInt(feeBps)) / BPS;
}

function cfgVal(cfg, name, index) {
  return cfg[name] !== undefined ? cfg[name] : cfg[index];
}

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.ROBIN_RPC);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const vault = new ethers.Contract(
    DEPLOY.contracts.vault,
    artifact("RobinIndexVault").abi,
    wallet
  );

  const receipt = new ethers.Contract(
    DEPLOY.contracts.receiptToken,
    artifact("ReceiptToken").abi,
    wallet
  );

  const AMZN = ethers.getAddress(DEPLOY.tokens.AMZN.address);
  const token = new ethers.Contract(AMZN, ERC20_ABI, wallet);

  const amount = ethers.parseUnits("0.001", 18);

  console.log("Wallet:", wallet.address);
  console.log("Vault :", DEPLOY.contracts.vault);
  console.log("Token : AMZN", AMZN);
  console.log("Amount:", ethers.formatUnits(amount, 18));
  console.log();

  if (await vault.paused()) {
    console.log("Vault is paused at start, unpausing first...");
    await waitTx("Vault.unpause()", await vault.unpause());
  }

  const feeConfig = await vault.feeConfig();

  const depositFeeBps = BigInt(cfgVal(feeConfig, "depositFeeBps", 0));
  const withdrawFeeBps = BigInt(cfgVal(feeConfig, "withdrawFeeBps", 1));
  const earlyWithdrawFeeBps = BigInt(cfgVal(feeConfig, "earlyWithdrawFeeBps", 2));
  const minHoldTime = BigInt(cfgVal(feeConfig, "minHoldTime", 3));

  console.log("Fee config:");
  console.log("depositFeeBps      :", depositFeeBps.toString());
  console.log("withdrawFeeBps     :", withdrawFeeBps.toString());
  console.log("earlyWithdrawFeeBps:", earlyWithdrawFeeBps.toString());
  console.log("minHoldTime        :", minHoldTime.toString(), "seconds");
  console.log();

  if (earlyWithdrawFeeBps <= withdrawFeeBps) {
    throw new Error("earlyWithdrawFeeBps is not greater than withdrawFeeBps; test would not prove early fee");
  }

  const walletTokenBefore = await token.balanceOf(wallet.address);
  const userBalBefore = await vault.userBalances(wallet.address, AMZN);
  const receiptBefore = await receipt.balanceOf(wallet.address);
  const pendingBefore = await vault.pendingFees(AMZN);

  console.log("Before:");
  console.log("wallet AMZN :", ethers.formatUnits(walletTokenBefore, 18));
  console.log("vault AMZN  :", ethers.formatUnits(userBalBefore, 18));
  console.log("rINDEX      :", ethers.formatUnits(receiptBefore, 18));
  console.log("pending AMZN:", ethers.formatUnits(pendingBefore, 18));
  console.log();

  if (walletTokenBefore < amount) {
    throw new Error("Wallet does not have enough AMZN for early withdraw test");
  }

  const allowance = await token.allowance(wallet.address, DEPLOY.contracts.vault);

  if (allowance < amount) {
    await waitTx("AMZN.approve(Vault)", await token.approve(DEPLOY.contracts.vault, amount));
  } else {
    console.log("Allowance already enough");
  }

  const expectedDepositFee = bps(amount, depositFeeBps);
  const expectedCredited = amount - expectedDepositFee;

  console.log("Expected deposit:");
  console.log("deposit fee wei :", expectedDepositFee.toString());
  console.log("credited wei    :", expectedCredited.toString());
  console.log();

  await waitTx("Vault.deposit(AMZN)", await vault.deposit(AMZN, amount));

  const userBalAfterDeposit = await vault.userBalances(wallet.address, AMZN);
  const receiptAfterDeposit = await receipt.balanceOf(wallet.address);
  const pendingAfterDeposit = await vault.pendingFees(AMZN);

  const creditedDelta = userBalAfterDeposit - userBalBefore;
  const receiptMinted = receiptAfterDeposit - receiptBefore;
  const pendingDelta = pendingAfterDeposit - pendingBefore;

  console.log("After deposit:");
  console.log("credited delta wei:", creditedDelta.toString());
  console.log("receipt minted wei:", receiptMinted.toString());
  console.log("pending delta wei :", pendingDelta.toString());
  console.log();

  let failures = 0;

  if (creditedDelta !== expectedCredited) {
    console.log("❌ Credited amount mismatch");
    failures++;
  } else {
    console.log("✅ Credited amount matches deposit fee");
  }

  if (pendingDelta !== expectedDepositFee) {
    console.log("❌ Deposit fee pending delta mismatch");
    failures++;
  } else {
    console.log("✅ Deposit fee pending delta matches");
  }

  const lastTokenDepositAt = await vault.lastTokenDepositAt(wallet.address, AMZN);
  const block = await provider.getBlock("latest");
  const age = BigInt(block.timestamp) - BigInt(lastTokenDepositAt);

  console.log();
  console.log("Hold age seconds:", age.toString());

  if (age >= minHoldTime) {
    throw new Error("Deposit is not inside early-withdraw window");
  }

  const preview = await vault.previewWithdraw(wallet.address, AMZN, creditedDelta);
  const previewFee = preview[0];
  const previewReturned = preview[1];
  const previewBurn = preview[2];

  const expectedNormalFee = bps(creditedDelta, withdrawFeeBps);
  const expectedEarlyFee = bps(creditedDelta, earlyWithdrawFeeBps);

  console.log();
  console.log("Withdraw preview for credited delta:");
  console.log("amount wei             :", creditedDelta.toString());
  console.log("normal fee expected wei:", expectedNormalFee.toString());
  console.log("early fee expected wei :", expectedEarlyFee.toString());
  console.log("preview fee wei        :", previewFee.toString());
  console.log("preview returned wei   :", previewReturned.toString());
  console.log("preview burn wei       :", previewBurn.toString());

  if (previewFee !== expectedEarlyFee) {
    console.log("❌ Preview fee does not match earlyWithdrawFeeBps");
    failures++;
  } else {
    console.log("✅ Preview fee matches earlyWithdrawFeeBps");
  }

  if (previewFee === expectedNormalFee) {
    console.log("❌ Preview fee equals normal withdraw fee; early fee not proven");
    failures++;
  } else {
    console.log("✅ Preview fee is different from normal withdraw fee");
  }

  if (failures > 0) {
    throw new Error(`Early withdraw fee pre-check failed with ${failures} failure(s)`);
  }

  await waitTx("Vault.withdraw(AMZN early)", await vault.withdraw(AMZN, creditedDelta));

  const userBalAfterWithdraw = await vault.userBalances(wallet.address, AMZN);
  const receiptAfterWithdraw = await receipt.balanceOf(wallet.address);
  const pendingAfterWithdraw = await vault.pendingFees(AMZN);

  const pendingWithdrawDelta = pendingAfterWithdraw - pendingAfterDeposit;
  const receiptBurned = receiptAfterDeposit - receiptAfterWithdraw;

  console.log();
  console.log("After early withdraw:");
  console.log("vault AMZN             :", ethers.formatUnits(userBalAfterWithdraw, 18));
  console.log("rINDEX                 :", ethers.formatUnits(receiptAfterWithdraw, 18));
  console.log("pending withdraw delta :", pendingWithdrawDelta.toString(), "wei");
  console.log("receipt burned         :", receiptBurned.toString(), "wei");

  if (pendingWithdrawDelta !== expectedEarlyFee) {
    console.log("❌ Pending fee delta after withdraw does not match early fee");
    failures++;
  } else {
    console.log("✅ Pending fee delta after withdraw matches early fee");
  }

  if (receiptBurned !== previewBurn) {
    console.log("❌ Receipt burn mismatch");
    failures++;
  } else {
    console.log("✅ Receipt burn matches preview");
  }

  const pendingCleanup = await vault.pendingFees(AMZN);

  if (pendingCleanup > 0n) {
    await waitTx("Vault.sweepFees(AMZN cleanup)", await vault.sweepFees(AMZN));
  }

  const pendingFinal = await vault.pendingFees(AMZN);
  console.log("Pending final:", pendingFinal.toString(), "wei");

  if (pendingFinal !== 0n) {
    console.log("❌ Pending fee not cleaned up");
    failures++;
  }

  if (failures > 0) {
    throw new Error(`Early withdraw fee test finished with ${failures} failure(s)`);
  }

  console.log();
  console.log("✅ Early withdraw fee test passed");
  console.log("✅ fresh deposit used earlyWithdrawFeeBps");
  console.log("✅ early withdraw fee was collected and swept");
}

main().catch((err) => {
  console.error();
  console.error("❌ Early withdraw fee test failed:");
  console.error(err.shortMessage || err.message || err);
  process.exit(1);
});
