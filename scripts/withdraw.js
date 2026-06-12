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
  "function balanceOf(address) view returns (uint256)",
];

async function waitTx(label, tx) {
  console.log(`TX ${label}: ${tx.hash}`);
  const rc = await tx.wait();
  console.log(`✅ ${label} mined block=${rc.blockNumber} gas=${rc.gasUsed}`);
  return rc;
}

function usage() {
  console.log("Usage:");
  console.log("  npm run withdraw -- SYMBOL AMOUNT");
  console.log();
  console.log("Examples:");
  console.log("  npm run withdraw -- TSLA 0.02");
  console.log("  npm run withdraw -- AMZN 0.05");
  process.exit(1);
}

async function main() {
  const symbol = (process.argv[2] || "").toUpperCase();
  const amountStr = process.argv[3];

  if (!symbol || !amountStr) usage();

  const cfg = DEPLOY.tokens[symbol];
  if (!cfg) throw new Error(`Unknown token symbol: ${symbol}`);

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

  const tokenAddr = ethers.getAddress(cfg.address);
  const token = new ethers.Contract(tokenAddr, ERC20_ABI, wallet);

  const dec = await token.decimals();
  const ercSymbol = await token.symbol();
  const amount = ethers.parseUnits(amountStr, dec);

  console.log("Wallet  :", wallet.address);
  console.log("Vault   :", DEPLOY.contracts.vault);
  console.log("Withdraw:", amountStr, ercSymbol, tokenAddr);
  console.log();

  const vaultBal = await vault.userBalances(wallet.address, tokenAddr);
  const walletBalBefore = await token.balanceOf(wallet.address);
  const rBefore = await receipt.balanceOf(wallet.address);

  console.log("Before:");
  console.log("wallet token :", ethers.formatUnits(walletBalBefore, dec));
  console.log("vault token  :", ethers.formatUnits(vaultBal, dec));
  console.log("rINDEX       :", ethers.formatUnits(rBefore, 18));
  console.log("vault paused :", await vault.paused());

  if (vaultBal < amount) {
    throw new Error(`Not enough vault ${symbol}. Vault balance=${ethers.formatUnits(vaultBal, dec)}`);
  }

  const preview = await vault.previewWithdraw(wallet.address, tokenAddr, amount);

  console.log();
  console.log("Preview:");
  console.log("feeAmount    :", ethers.formatUnits(preview[0], dec));
  console.log("returned     :", ethers.formatUnits(preview[1], dec));
  console.log("burned rINDEX:", ethers.formatUnits(preview[2], 18));

  await waitTx(`Vault.withdraw(${symbol},${amountStr})`, await vault.withdraw(tokenAddr, amount));

  const userBalAfter = await vault.userBalances(wallet.address, tokenAddr);
  const walletBalAfter = await token.balanceOf(wallet.address);
  const rAfter = await receipt.balanceOf(wallet.address);
  const pending = await vault.pendingFees(tokenAddr);

  console.log();
  console.log("After withdraw:");
  console.log("wallet token :", ethers.formatUnits(walletBalAfter, dec));
  console.log("vault token  :", ethers.formatUnits(userBalAfter, dec));
  console.log("rINDEX       :", ethers.formatUnits(rAfter, 18));
  console.log("pending fee  :", ethers.formatUnits(pending, dec));
  console.log();
  console.log("✅ Withdraw complete");
}

main().catch((err) => {
  console.error("\n❌ Withdraw failed:");
  console.error(err.shortMessage || err.message || err);
  process.exit(1);
});
