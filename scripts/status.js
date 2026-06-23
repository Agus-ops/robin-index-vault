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
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
];

function fmt(amount, decimals) {
  return ethers.formatUnits(amount, decimals);
}

function priceFmt(price8) {
  return Number(price8) / 1e8;
}

function fmtTime(seconds) {
  if (seconds <= 0) return "ready";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h ${m}m ${s}s`;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.ROBIN_RPC);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const chainId = Number((await provider.getNetwork()).chainId);
  const block = await provider.getBlock("latest");
  const nativeBal = await provider.getBalance(wallet.address);

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

  console.log("========================================");
  console.log(" Robin Index Vault Status");
  console.log("========================================");
  console.log("Chain ID      :", chainId);
  console.log("Block         :", block.number);
  console.log("Wallet        :", wallet.address);
  console.log("Native balance:", ethers.formatEther(nativeBal));
  console.log();

  console.log("Contracts:");
  console.log("Oracle       :", DEPLOY.contracts.oracle);
  console.log("ReceiptToken :", DEPLOY.contracts.receiptToken);
  console.log("Treasury     :", DEPLOY.contracts.treasury);
  console.log("Vault        :", DEPLOY.contracts.vault);
  console.log();

  console.log("Core flags:");
  console.log("Vault paused        :", await vault.paused());
  console.log("Receipt vault       :", await receipt.vault());
  console.log("Receipt vaultLocked :", await receipt.vaultLocked());
  console.log("Treasury paused     :", await treasury.paused());
  console.log();

  const rBal = await receipt.balanceOf(wallet.address);
  const rSupply = await receipt.totalSupply();

  console.log("rINDEX:");
  console.log("Wallet rINDEX:", fmt(rBal, 18));
  console.log("Total supply :", fmt(rSupply, 18));
  console.log();

  const lastRebalance = await vault.lastRebalanceAt(wallet.address);
  const cooldown = 24 * 60 * 60;
  const remaining =
    lastRebalance === 0n
      ? 0
      : Math.max(0, Number(lastRebalance) + cooldown - block.timestamp);

  console.log("Daily check:");
  console.log("Last check    :", lastRebalance.toString());
  console.log("Next available:", fmtTime(remaining));
  console.log();

  let totalPortfolioUsd = 0n;
  let allFresh = true;

  console.log("Assets:");
  console.log("--------------------------------------------------------------------------------");

  for (const [symbol, cfg] of Object.entries(DEPLOY.tokens)) {
    const tokenAddr = ethers.getAddress(cfg.address);
    const token = new ethers.Contract(tokenAddr, ERC20_ABI, wallet);

    let dec = cfg.decimals;
    let ercSymbol = symbol;

    try {
      dec = Number(await token.decimals());
      ercSymbol = await token.symbol();
    } catch {}

    const walletBal = await token.balanceOf(wallet.address);
    const vaultUserBal = await vault.userBalances(wallet.address, tokenAddr);
    const pendingFee = await vault.pendingFees(tokenAddr);
    const allowance = await token.allowance(wallet.address, DEPLOY.contracts.vault);

    const tokenConfig = await vault.tokenConfigs(tokenAddr);
    const priceData = await oracle.getPriceData(tokenAddr);
    const fresh = await oracle.isFresh(tokenAddr);

    const price8 = priceData[0];
    const oracleSupported = priceData[2];

    if (oracleSupported && price8 > 0n && fresh && vaultUserBal > 0n) {
      const usd18 = (vaultUserBal * price8 * 10n ** 10n) / (10n ** BigInt(dec));
      totalPortfolioUsd += usd18;
    }

    if (vaultUserBal > 0n && !fresh) {
      allFresh = false;
    }

    const buckets = await treasury.getBuckets(tokenAddr);

    console.log(`${symbol} (${ercSymbol})`);
    console.log("  token        :", tokenAddr);
    console.log("  decimals     :", dec);
    console.log("  config       : supported=", tokenConfig[0], "stock=", tokenConfig[1], "settlement=", tokenConfig[2]);
    console.log("  oracle       : supported=", oracleSupported, "fresh=", fresh, "price=$" + priceFmt(price8));
    console.log("  wallet bal   :", fmt(walletBal, dec));
    console.log("  vault bal    :", fmt(vaultUserBal, dec));
    console.log("  allowance    :", fmt(allowance, dec));
    console.log("  pending fee  :", fmt(pendingFee, dec));
    console.log("  treasury:");
    console.log("    reserve    :", fmt(buckets[0], dec));
    console.log("    rewards    :", fmt(buckets[1], dec));
    console.log("    router     :", fmt(buckets[2], dec));
    console.log("    operator   :", fmt(buckets[3], dec));
    console.log("    received   :", fmt(buckets[4], dec));
    console.log("--------------------------------------------------------------------------------");
  }

  const portfolioView = await vault.getUserPortfolioValueUsd(wallet.address);

  console.log();
  console.log("Portfolio:");
  console.log("CLI computed USD :", fmt(totalPortfolioUsd, 18));
  console.log("Vault view USD   :", fmt(portfolioView[0], 18));
  console.log("All prices fresh :", portfolioView[1], "/", allFresh);
  console.log();

  console.log("✅ Status complete");
}

main().catch((err) => {
  console.error("\n❌ Status failed:");
  console.error(err);
  process.exit(1);
});
