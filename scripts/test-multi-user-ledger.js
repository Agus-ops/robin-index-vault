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

function cfgVal(cfg, name, index) {
  return cfg[name] !== undefined ? cfg[name] : cfg[index];
}

function bps(amount, feeBps) {
  return (amount * BigInt(feeBps)) / BPS;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.ROBIN_RPC);

  const mainWallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const secondWallet = new ethers.Wallet(process.env.SECOND_PRIVATE_KEY, provider);

  if (process.env.SECOND_ADDRESS && secondWallet.address.toLowerCase() !== process.env.SECOND_ADDRESS.toLowerCase()) {
    throw new Error("SECOND_PRIVATE_KEY does not match SECOND_ADDRESS");
  }

  const vault = new ethers.Contract(
    DEPLOY.contracts.vault,
    artifact("RobinIndexVault").abi,
    mainWallet
  );

  const vaultSecond = vault.connect(secondWallet);

  const receipt = new ethers.Contract(
    DEPLOY.contracts.receiptToken,
    artifact("ReceiptToken").abi,
    mainWallet
  );

  const AMZN = ethers.getAddress(DEPLOY.tokens.AMZN.address);
  const tokenMain = new ethers.Contract(AMZN, ERC20_ABI, mainWallet);
  const tokenSecond = new ethers.Contract(AMZN, ERC20_ABI, secondWallet);

  const depositAmount = ethers.parseUnits("0.001", 18);

  console.log("Main wallet  :", mainWallet.address);
  console.log("Second wallet:", secondWallet.address);
  console.log("Vault        :", DEPLOY.contracts.vault);
  console.log("Token        : AMZN", AMZN);
  console.log("Deposit      :", ethers.formatUnits(depositAmount, 18));
  console.log();

  if (await vault.paused()) {
    console.log("Vault is paused at start, unpausing first...");
    await waitTx("Vault.unpause()", await vault.unpause());
  }

  const secondNative = await provider.getBalance(secondWallet.address);
  const secondToken = await tokenSecond.balanceOf(secondWallet.address);

  console.log("Second native:", ethers.formatEther(secondNative));
  console.log("Second AMZN  :", ethers.formatUnits(secondToken, 18));
  console.log();

  if (secondNative === 0n) {
    throw new Error("Second wallet has no native gas");
  }

  if (secondToken < depositAmount) {
    throw new Error("Second wallet does not have enough AMZN");
  }

  const feeConfig = await vault.feeConfig();
  const depositFeeBps = BigInt(cfgVal(feeConfig, "depositFeeBps", 0));

  const expectedDepositFee = bps(depositAmount, depositFeeBps);
  const expectedCredited = depositAmount - expectedDepositFee;

  console.log("Deposit fee bps :", depositFeeBps.toString());
  console.log("Expected fee wei:", expectedDepositFee.toString());
  console.log("Expected credit :", expectedCredited.toString(), "wei");
  console.log();

  const aBalBefore = await vault.userBalances(mainWallet.address, AMZN);
  const bBalBefore = await vault.userBalances(secondWallet.address, AMZN);
  const aReceiptBefore = await receipt.balanceOf(mainWallet.address);
  const bReceiptBefore = await receipt.balanceOf(secondWallet.address);
  const supplyBefore = await receipt.totalSupply();
  const pendingBefore = await vault.pendingFees(AMZN);
  const bHadDepositedBefore = await vault.hasEverDeposited(secondWallet.address);

  let totalUsersBefore = null;
  let hasTotalUsers = typeof vault.totalUsers === "function";

  if (hasTotalUsers) {
    totalUsersBefore = await vault.totalUsers();
  }

  console.log("Before:");
  console.log("A vault AMZN :", ethers.formatUnits(aBalBefore, 18));
  console.log("B vault AMZN :", ethers.formatUnits(bBalBefore, 18));
  console.log("A rINDEX     :", ethers.formatUnits(aReceiptBefore, 18));
  console.log("B rINDEX     :", ethers.formatUnits(bReceiptBefore, 18));
  console.log("totalSupply  :", ethers.formatUnits(supplyBefore, 18));
  console.log("pending AMZN :", ethers.formatUnits(pendingBefore, 18));
  console.log("B had deposit:", bHadDepositedBefore);
  if (hasTotalUsers) console.log("totalUsers   :", totalUsersBefore.toString());
  console.log();

  let failures = 0;

  const allowance = await tokenSecond.allowance(secondWallet.address, DEPLOY.contracts.vault);

  if (allowance < depositAmount) {
    await waitTx(
      "Second AMZN.approve(Vault)",
      await tokenSecond.approve(DEPLOY.contracts.vault, depositAmount)
    );
  } else {
    console.log("Second allowance already enough");
  }

  await waitTx(
    "Second Vault.deposit(AMZN)",
    await vaultSecond.deposit(AMZN, depositAmount)
  );

  const aBalAfterDeposit = await vault.userBalances(mainWallet.address, AMZN);
  const bBalAfterDeposit = await vault.userBalances(secondWallet.address, AMZN);
  const aReceiptAfterDeposit = await receipt.balanceOf(mainWallet.address);
  const bReceiptAfterDeposit = await receipt.balanceOf(secondWallet.address);
  const supplyAfterDeposit = await receipt.totalSupply();
  const pendingAfterDeposit = await vault.pendingFees(AMZN);
  const bHadDepositedAfter = await vault.hasEverDeposited(secondWallet.address);

  const bCreditedDelta = bBalAfterDeposit - bBalBefore;
  const bReceiptMinted = bReceiptAfterDeposit - bReceiptBefore;
  const pendingDepositDelta = pendingAfterDeposit - pendingBefore;

  console.log();
  console.log("After B deposit:");
  console.log("B credited delta wei:", bCreditedDelta.toString());
  console.log("B receipt minted wei:", bReceiptMinted.toString());
  console.log("pending delta wei   :", pendingDepositDelta.toString());
  console.log();

  if (aBalAfterDeposit !== aBalBefore) {
    console.log("❌ A vault balance changed after B deposit");
    failures++;
  } else {
    console.log("✅ A vault balance unchanged after B deposit");
  }

  if (aReceiptAfterDeposit !== aReceiptBefore) {
    console.log("❌ A receipt changed after B deposit");
    failures++;
  } else {
    console.log("✅ A receipt unchanged after B deposit");
  }

  if (bCreditedDelta !== expectedCredited) {
    console.log("❌ B credited amount mismatch");
    failures++;
  } else {
    console.log("✅ B credited amount matches deposit fee");
  }

  if (pendingDepositDelta !== expectedDepositFee) {
    console.log("❌ Pending fee delta mismatch after B deposit");
    failures++;
  } else {
    console.log("✅ Pending fee delta matches after B deposit");
  }

  if (!bHadDepositedAfter) {
    console.log("❌ B hasEverDeposited still false after deposit");
    failures++;
  } else {
    console.log("✅ B hasEverDeposited true after deposit");
  }

  if (supplyAfterDeposit !== aReceiptAfterDeposit + bReceiptAfterDeposit) {
    console.log("❌ totalSupply != A receipt + B receipt after deposit");
    failures++;
  } else {
    console.log("✅ totalSupply equals A receipt + B receipt after deposit");
  }

  if (hasTotalUsers) {
    const totalUsersAfterDeposit = await vault.totalUsers();
    console.log("totalUsers after B deposit:", totalUsersAfterDeposit.toString());

    if (!bHadDepositedBefore && totalUsersAfterDeposit !== totalUsersBefore + 1n) {
      console.log("❌ totalUsers did not increase by 1 for new B user");
      failures++;
    } else {
      console.log("✅ totalUsers behavior valid");
    }
  } else {
    console.log("⚠️ totalUsers() not in ABI, skipping totalUsers check");
  }

  const withdrawAmount = expectedCredited / 2n;
  const preview = await vault.previewWithdraw(secondWallet.address, AMZN, withdrawAmount);
  const previewFee = preview[0];
  const previewReturned = preview[1];
  const previewBurn = preview[2];

  console.log();
  console.log("B withdraw preview:");
  console.log("amount wei  :", withdrawAmount.toString());
  console.log("fee wei     :", previewFee.toString());
  console.log("returned wei:", previewReturned.toString());
  console.log("burn wei    :", previewBurn.toString());

  await waitTx(
    "Second Vault.withdraw(AMZN)",
    await vaultSecond.withdraw(AMZN, withdrawAmount)
  );

  const aBalAfterWithdraw = await vault.userBalances(mainWallet.address, AMZN);
  const bBalAfterWithdraw = await vault.userBalances(secondWallet.address, AMZN);
  const aReceiptAfterWithdraw = await receipt.balanceOf(mainWallet.address);
  const bReceiptAfterWithdraw = await receipt.balanceOf(secondWallet.address);
  const supplyAfterWithdraw = await receipt.totalSupply();
  const pendingAfterWithdraw = await vault.pendingFees(AMZN);

  console.log();
  console.log("After B withdraw:");
  console.log("A vault AMZN :", ethers.formatUnits(aBalAfterWithdraw, 18));
  console.log("B vault AMZN :", ethers.formatUnits(bBalAfterWithdraw, 18));
  console.log("A rINDEX     :", ethers.formatUnits(aReceiptAfterWithdraw, 18));
  console.log("B rINDEX     :", ethers.formatUnits(bReceiptAfterWithdraw, 18));
  console.log("totalSupply  :", ethers.formatUnits(supplyAfterWithdraw, 18));
  console.log("pending AMZN :", ethers.formatUnits(pendingAfterWithdraw, 18));
  console.log();

  if (aBalAfterWithdraw !== aBalBefore) {
    console.log("❌ A vault balance changed after B withdraw");
    failures++;
  } else {
    console.log("✅ A vault balance unchanged after B withdraw");
  }

  if (aReceiptAfterWithdraw !== aReceiptBefore) {
    console.log("❌ A receipt changed after B withdraw");
    failures++;
  } else {
    console.log("✅ A receipt unchanged after B withdraw");
  }

  if (bBalAfterWithdraw !== bBalAfterDeposit - withdrawAmount) {
    console.log("❌ B vault balance not reduced by withdraw amount");
    failures++;
  } else {
    console.log("✅ B vault balance reduced correctly");
  }

  if (bReceiptAfterWithdraw !== bReceiptAfterDeposit - previewBurn) {
    console.log("❌ B receipt not burned according to preview");
    failures++;
  } else {
    console.log("✅ B receipt burn matches preview");
  }

  if (supplyAfterWithdraw !== aReceiptAfterWithdraw + bReceiptAfterWithdraw) {
    console.log("❌ totalSupply != A receipt + B receipt after withdraw");
    failures++;
  } else {
    console.log("✅ totalSupply equals A receipt + B receipt after withdraw");
  }

  const expectedPendingTotalDelta = expectedDepositFee + previewFee;
  const pendingTotalDelta = pendingAfterWithdraw - pendingBefore;

  if (pendingTotalDelta !== expectedPendingTotalDelta) {
    console.log("❌ Pending total delta mismatch");
    console.log("expected:", expectedPendingTotalDelta.toString());
    console.log("actual  :", pendingTotalDelta.toString());
    failures++;
  } else {
    console.log("✅ Pending fee delta includes B deposit fee + B withdraw fee");
  }

  if (pendingAfterWithdraw > 0n) {
    await waitTx("Main Vault.sweepFees(AMZN cleanup)", await vault.sweepFees(AMZN));
  }

  const pendingFinal = await vault.pendingFees(AMZN);
  console.log("Pending final:", pendingFinal.toString(), "wei");

  if (pendingFinal !== 0n) {
    console.log("❌ Pending fee not cleaned up");
    failures++;
  }

  if (failures > 0) {
    throw new Error(`Multi-user ledger test finished with ${failures} failure(s)`);
  }

  console.log();
  console.log("✅ Multi-user ledger test passed");
  console.log("✅ A/B ledgers are isolated");
  console.log("✅ B deposit/withdraw did not affect A");
  console.log("✅ totalSupply equals A+B receipt balances");
  console.log("✅ fees collected and swept cleanly");
}

main().catch((err) => {
  console.error();
  console.error("❌ Multi-user ledger test failed:");
  console.error(err.shortMessage || err.message || err);
  process.exit(1);
});
