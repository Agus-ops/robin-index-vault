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

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

async function waitTx(label, tx) {
  console.log(`TX ${label}: ${tx.hash}`);
  const rc = await tx.wait();
  console.log(`✅ ${label} mined block=${rc.blockNumber} gas=${rc.gasUsed}`);
  return rc;
}

function usage() {
  console.log("Usage:");
  console.log("  npm run sweep -- SYMBOL");
  console.log();
  console.log("Examples:");
  console.log("  npm run sweep -- AMZN");
  console.log("  npm run sweep -- TSLA");
  process.exit(1);
}

async function main() {
  const symbol = (process.argv[2] || "").toUpperCase();
  if (!symbol) usage();

  const cfg = DEPLOY.tokens[symbol];
  if (!cfg) throw new Error(`Unknown token symbol: ${symbol}`);

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

  const tokenAddr = ethers.getAddress(cfg.address);
  const token = new ethers.Contract(tokenAddr, ERC20_ABI, wallet);

  const dec = await token.decimals();
  const ercSymbol = await token.symbol();

  console.log("Wallet :", wallet.address);
  console.log("Vault  :", DEPLOY.contracts.vault);
  console.log("Treasury:", DEPLOY.contracts.treasury);
  console.log("Sweep  :", ercSymbol, tokenAddr);
  console.log();

  const pending = await vault.pendingFees(tokenAddr);
  console.log("Pending fee:", ethers.formatUnits(pending, dec));

  if (pending === 0n) {
    console.log("No fee to sweep.");
    return;
  }

  await waitTx(`Vault.sweepFees(${symbol})`, await vault.sweepFees(tokenAddr));

  const buckets = await treasury.getBuckets(tokenAddr);
  const pendingAfter = await vault.pendingFees(tokenAddr);

  console.log();
  console.log("After sweep:");
  console.log("pending :", ethers.formatUnits(pendingAfter, dec));
  console.log("reserve :", ethers.formatUnits(buckets[0], dec));
  console.log("rewards :", ethers.formatUnits(buckets[1], dec));
  console.log("router  :", ethers.formatUnits(buckets[2], dec));
  console.log("operator:", ethers.formatUnits(buckets[3], dec));
  console.log("received:", ethers.formatUnits(buckets[4], dec));
  console.log();
  console.log("✅ Sweep complete");
}

main().catch((err) => {
  console.error("\n❌ Sweep failed:");
  console.error(err.shortMessage || err.message || err);
  process.exit(1);
});
