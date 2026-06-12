import fs from "fs";
import path from "path";
import "dotenv/config";
import { ethers } from "ethers";
import { TOKENS, INITIAL_PRICES_8 } from "./tokens.js";

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

  const oracle = new ethers.Contract(
    DEPLOY.contracts.oracle,
    artifact("MockStockOracle").abi,
    wallet
  );

  const tokens = [];
  const prices = [];

  for (const [symbol, cfg] of Object.entries(TOKENS)) {
    if (INITIAL_PRICES_8[symbol] === undefined) continue;

    tokens.push(ethers.getAddress(cfg.address));
    prices.push(INITIAL_PRICES_8[symbol]);

    console.log(symbol, "=>", INITIAL_PRICES_8[symbol].toString());
  }

  console.log();
  console.log("Oracle:", DEPLOY.contracts.oracle);
  console.log("Wallet:", wallet.address);
  console.log();

  await waitTx("Oracle.setPrices(refresh)", await oracle.setPrices(tokens, prices));

  console.log();
  for (const [symbol, cfg] of Object.entries(TOKENS)) {
    const token = ethers.getAddress(cfg.address);
    const data = await oracle.getPriceData(token);
    const fresh = await oracle.isFresh(token);
    console.log(symbol, "price8=", data[0].toString(), "fresh=", fresh);
  }

  console.log();
  console.log("✅ Prices refreshed");
}

main().catch((err) => {
  console.error("\n❌ Refresh prices failed:");
  console.error(err.shortMessage || err.message || err);
  process.exit(1);
});
