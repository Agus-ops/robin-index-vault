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

function usage() {
  console.log("Usage:");
  console.log("  npm run price -- SYMBOL PRICE_USD");
  console.log();
  console.log("Examples:");
  console.log("  npm run price -- TSLA 181.25");
  console.log("  npm run price -- AMD 162.5");
  process.exit(1);
}

function toPrice8(priceStr) {
  if (!/^\d+(\.\d+)?$/.test(priceStr)) {
    throw new Error("Invalid price format");
  }

  const [whole, fracRaw = ""] = priceStr.split(".");
  const frac = (fracRaw + "00000000").slice(0, 8);
  return BigInt(whole) * 100000000n + BigInt(frac);
}

async function waitTx(label, tx) {
  console.log(`TX ${label}: ${tx.hash}`);
  const rc = await tx.wait();
  console.log(`✅ ${label} mined block=${rc.blockNumber} gas=${rc.gasUsed}`);
  return rc;
}

async function main() {
  const symbol = (process.argv[2] || "").toUpperCase();
  const priceStr = process.argv[3];

  if (!symbol || !priceStr) usage();

  const cfg = DEPLOY.tokens[symbol];
  if (!cfg) throw new Error(`Unknown token symbol: ${symbol}`);

  const provider = new ethers.JsonRpcProvider(process.env.ROBIN_RPC);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const oracle = new ethers.Contract(
    DEPLOY.contracts.oracle,
    artifact("MockStockOracle").abi,
    wallet
  );

  const token = ethers.getAddress(cfg.address);
  const price8 = toPrice8(priceStr);

  console.log("Wallet :", wallet.address);
  console.log("Oracle :", DEPLOY.contracts.oracle);
  console.log("Token  :", symbol, token);
  console.log("Price  :", priceStr, "USD");
  console.log("Price8 :", price8.toString());
  console.log();

  await waitTx(`Oracle.setPrice(${symbol})`, await oracle.setPrice(token, price8));

  const latest = await oracle.getPriceData(token);
  const fresh = await oracle.isFresh(token);

  console.log();
  console.log("After:");
  console.log("price8 :", latest[0].toString());
  console.log("updated:", latest[1].toString());
  console.log("fresh  :", fresh);
  console.log();
  console.log("✅ Price update complete");
}

main().catch((err) => {
  console.error("\n❌ Price update failed:");
  console.error(err.shortMessage || err.message || err);
  process.exit(1);
});
