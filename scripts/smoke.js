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
  console.log(`\nTX ${label}: ${tx.hash}`);
  const rc = await tx.wait();
  console.log(`✅ ${label} mined block=${rc.blockNumber} gas=${rc.gasUsed}`);
  return rc;
}

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.ROBIN_RPC);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const chainId = Number((await provider.getNetwork()).chainId);
  if (chainId !== 46630) throw new Error(`Wrong chainId ${chainId}`);

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

  const treasury = new ethers.Contract(
    DEPLOY.contracts.treasury,
    artifact("FeeTreasury").abi,
    wallet
  );

  const oracle = new ethers.Contract(
    DEPLOY.contracts.oracle,
    artifact("MockStockOracle").abi,
    wallet
  );

  const TSLA = ethers.getAddress(DEPLOY.tokens.TSLA.address);
  const tsla = new ethers.Contract(TSLA, ERC20_ABI, wallet);

  const dec = await tsla.decimals();
  const sym = await tsla.symbol();

  const depositAmount = ethers.parseUnits("0.1", dec);
  const withdrawAmount = ethers.parseUnits("0.02", dec);

  console.log("Wallet :", wallet.address);
  console.log("Vault  :", DEPLOY.contracts.vault);
  console.log("Token  :", sym, TSLA);
  console.log();

  const price = await oracle.getPrice(TSLA);
  const fresh = await oracle.isFresh(TSLA);
  console.log("Oracle TSLA price 8d:", price.toString());
  console.log("Oracle fresh        :", fresh);

  const balBefore = await tsla.balanceOf(wallet.address);
  console.log("Wallet TSLA before  :", ethers.formatUnits(balBefore, dec));

  if (balBefore < depositAmount) {
    throw new Error("Not enough TSLA for smoke deposit");
  }

  const preview = await vault.previewDeposit(TSLA, depositAmount);
  console.log();
  console.log("Preview deposit 0.1 TSLA:");
  console.log("feeAmount     :", ethers.formatUnits(preview[0], dec));
  console.log("creditedAmount:", ethers.formatUnits(preview[1], dec));
  console.log("minted rINDEX :", ethers.formatUnits(preview[2], 18));
  console.log("priceUsd 8d   :", preview[3].toString());
  console.log("price fresh   :", preview[4]);

  const allowance = await tsla.allowance(wallet.address, DEPLOY.contracts.vault);
  if (allowance < depositAmount) {
    await waitTx("Approve TSLA to Vault", await tsla.approve(DEPLOY.contracts.vault, depositAmount));
  } else {
    console.log("\nAllowance already enough.");
  }

  await waitTx("Vault.deposit(TSLA,0.1)", await vault.deposit(TSLA, depositAmount));

  const userBalAfterDeposit = await vault.userBalances(wallet.address, TSLA);
  const rIndexAfterDeposit = await receipt.balanceOf(wallet.address);
  const pendingAfterDeposit = await vault.pendingFees(TSLA);

  console.log();
  console.log("After deposit:");
  console.log("Vault user TSLA :", ethers.formatUnits(userBalAfterDeposit, dec));
  console.log("rINDEX balance  :", ethers.formatUnits(rIndexAfterDeposit, 18));
  console.log("Pending fee TSLA:", ethers.formatUnits(pendingAfterDeposit, dec));

  const pWithdraw = await vault.previewWithdraw(wallet.address, TSLA, withdrawAmount);
  console.log();
  console.log("Preview withdraw 0.02 TSLA:");
  console.log("feeAmount    :", ethers.formatUnits(pWithdraw[0], dec));
  console.log("returned     :", ethers.formatUnits(pWithdraw[1], dec));
  console.log("burned rINDEX:", ethers.formatUnits(pWithdraw[2], 18));

  await waitTx("Vault.withdraw(TSLA,0.02)", await vault.withdraw(TSLA, withdrawAmount));

  const userBalAfterWithdraw = await vault.userBalances(wallet.address, TSLA);
  const rIndexAfterWithdraw = await receipt.balanceOf(wallet.address);
  const pendingAfterWithdraw = await vault.pendingFees(TSLA);

  console.log();
  console.log("After withdraw:");
  console.log("Vault user TSLA :", ethers.formatUnits(userBalAfterWithdraw, dec));
  console.log("rINDEX balance  :", ethers.formatUnits(rIndexAfterWithdraw, 18));
  console.log("Pending fee TSLA:", ethers.formatUnits(pendingAfterWithdraw, dec));

  if (pendingAfterWithdraw > 0n) {
    await waitTx("Vault.sweepFees(TSLA)", await vault.sweepFees(TSLA));
  }

  const buckets = await treasury.getBuckets(TSLA);

  console.log();
  console.log("Treasury TSLA buckets:");
  console.log("reserve :", ethers.formatUnits(buckets[0], dec));
  console.log("rewards :", ethers.formatUnits(buckets[1], dec));
  console.log("router  :", ethers.formatUnits(buckets[2], dec));
  console.log("operator:", ethers.formatUnits(buckets[3], dec));
  console.log("received:", ethers.formatUnits(buckets[4], dec));
  console.log("withdrawn:", ethers.formatUnits(buckets[5], dec));

  const walletBalAfter = await tsla.balanceOf(wallet.address);
  console.log();
  console.log("Wallet TSLA after:", ethers.formatUnits(walletBalAfter, dec));

  console.log("\n✅ Smoke test complete");
}

main().catch((err) => {
  console.error("\n❌ Smoke failed:");
  console.error(err);
  process.exit(1);
});
