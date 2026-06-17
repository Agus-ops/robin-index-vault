import fs from "fs";
import path from "path";
import "dotenv/config";
import { ethers } from "ethers";

const ROOT = process.cwd();
const DEPLOY = JSON.parse(
  fs.readFileSync(path.join(ROOT, "deployments/robinhood-46630.json"), "utf8")
);

function artifact(name) {
  return JSON.parse(
    fs.readFileSync(path.join(ROOT, "artifacts", `${name}.json`), "utf8")
  );
}

const STOCKS = ["TSLA", "AMZN", "NFLX", "PLTR", "AMD"];
const ROUTER = "0x95c7e649D972f34C2a67813c86ed6936F2008149";

const ROUTER_ABI = [
  "function tokenConfig(address token) view returns (bool supported, uint256 maxSingleSwap, uint256 dailyCap, uint256 minInventory, uint256 lowInventoryAlert)",
];

const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function symbol() view returns (string)",
];

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.ROBIN_RPC);
  const router = new ethers.Contract(ROUTER, ROUTER_ABI, provider);

  console.log("========================================");
  console.log(" Robin Index Vault Router Keeper");
  console.log("========================================");
  console.log("Router:", ROUTER);
  console.log("");

  for (const symbol of STOCKS) {
    const tokenAddr = ethers.getAddress(DEPLOY.tokens[symbol].address);
    const token = new ethers.Contract(tokenAddr, ERC20_ABI, provider);

    const [cfg, balance, tokenSymbol] = await Promise.all([
      router.tokenConfig(tokenAddr),
      token.balanceOf(ROUTER),
      token.symbol(),
    ]);

    const supported = cfg[0];
    const minInventory = cfg[3];
    const lowInventoryAlert = cfg[4];

    if (!supported) {
      console.log(`[${tokenSymbol}] Not supported, skip`);
      continue;
    }

    const balFormatted = ethers.formatUnits(balance, DEPLOY.tokens[symbol].decimals);
    const minFormatted = ethers.formatUnits(minInventory, DEPLOY.tokens[symbol].decimals);
    const alertFormatted = ethers.formatUnits(lowInventoryAlert, DEPLOY.tokens[symbol].decimals);

    console.log(`[${tokenSymbol}] Balance: ${balFormatted} | Min: ${minFormatted} | Alert: ${alertFormatted}`);

    if (balance < lowInventoryAlert) {
      console.log(`⚠️  LOW INVENTORY ALERT: ${tokenSymbol} is below alert threshold!`);
    }
    if (balance < minInventory) {
      console.log(`🚨 CRITICAL: ${tokenSymbol} is below minimum inventory!`);
    }
    console.log("");
  }

  console.log("✅ Router keeper complete");
}

main().catch((err) => {
  console.error("❌ Router keeper failed:", err.message);
  process.exit(1);
});
