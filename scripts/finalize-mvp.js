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

async function waitTx(label, tx) {
  console.log(`TX ${label}: ${tx.hash}`);
  const rc = await tx.wait();
  console.log(`✅ ${label} mined block=${rc.blockNumber} gas=${rc.gasUsed}`);
  return rc;
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

  const treasury = new ethers.Contract(
    DEPLOY.contracts.treasury,
    artifact("FeeTreasury").abi,
    wallet
  );

  const TSLA = ethers.getAddress(DEPLOY.tokens.TSLA.address);
  const dec = 18;

  console.log("Wallet :", wallet.address);
  console.log("Vault  :", DEPLOY.contracts.vault);
  console.log("Receipt:", DEPLOY.contracts.receiptToken);
  console.log("Treasury:", DEPLOY.contracts.treasury);
  console.log();

  const pending = await vault.pendingFees(TSLA);
  console.log("Pending TSLA fee:", ethers.formatUnits(pending, dec));

  if (pending > 0n) {
    await waitTx("Vault.sweepFees(TSLA)", await vault.sweepFees(TSLA));
  } else {
    console.log("No pending TSLA fee to sweep.");
  }

  const lastRebalance = await vault.lastRebalanceAt(wallet.address);
  if (lastRebalance === 0n) {
    await waitTx(
      "Vault.dailyRebalanceCheck(MVP_FINAL_CHECK)",
      await vault.dailyRebalanceCheck("MVP_FINAL_CHECK")
    );
  } else {
    console.log("Daily rebalance already used, skipping.");
  }

  const currentVault = await receipt.vault();
  const locked = await receipt.vaultLocked();

  console.log();
  console.log("Receipt current vault:", currentVault);
  console.log("Receipt vaultLocked  :", locked);

  if (currentVault.toLowerCase() !== DEPLOY.contracts.vault.toLowerCase()) {
    throw new Error("Receipt vault does not match deployed vault. Refusing to lock.");
  }

  if (!locked) {
    await waitTx("ReceiptToken.lockVault()", await receipt.lockVault());
  } else {
    console.log("Receipt vault already locked.");
  }

  const buckets = await treasury.getBuckets(TSLA);
  const userVaultBal = await vault.userBalances(wallet.address, TSLA);
  const rIndexBal = await receipt.balanceOf(wallet.address);
  const totalSupply = await receipt.totalSupply();

  console.log();
  console.log("Final MVP status:");
  console.log("vault user TSLA :", ethers.formatUnits(userVaultBal, dec));
  console.log("rINDEX balance  :", ethers.formatUnits(rIndexBal, 18));
  console.log("rINDEX supply   :", ethers.formatUnits(totalSupply, 18));
  console.log("vault locked    :", await receipt.vaultLocked());
  console.log();
  console.log("Treasury TSLA buckets:");
  console.log("reserve :", ethers.formatUnits(buckets[0], dec));
  console.log("rewards :", ethers.formatUnits(buckets[1], dec));
  console.log("router  :", ethers.formatUnits(buckets[2], dec));
  console.log("operator:", ethers.formatUnits(buckets[3], dec));
  console.log("received:", ethers.formatUnits(buckets[4], dec));
  console.log("withdrawn:", ethers.formatUnits(buckets[5], dec));

  console.log("\n✅ MVP finalized");
}

main().catch((err) => {
  console.error("\n❌ Finalize failed:");
  console.error(err);
  process.exit(1);
});
