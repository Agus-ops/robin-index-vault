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
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];

async function waitTx(label, tx) {
  console.log(`TX ${label}: ${tx.hash}`);
  const rc = await tx.wait();
  console.log(`✅ ${label} mined block=${rc.blockNumber} gas=${rc.gasUsed}`);
  return rc;
}

function usage() {
  console.log("Usage:");
  console.log("  npm run deposit -- SYMBOL AMOUNT");
  console.log();
  console.log("Examples:");
  console.log("  npm run deposit -- AMZN 0.1");
  console.log("  npm run deposit -- AMD 0.25");
  process.exit(1);
}

async function main() {
  const symbol = (process.argv[2] || "").toUpperCase();
  const amountStr = process.argv[3];

  if (!symbol || !amountStr) usage();

  const cfg = DEPLOY.tokens[symbol];
  if (!cfg) throw new Error(`Unknown token symbol: ${symbol}`);
  if (!cfg.isStock) throw new Error(`${symbol} is not a stock token deposit asset`);

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

  const oracle = new ethers.Contract(
    DEPLOY.contracts.oracle,
    artifact("MockStockOracle").abi,
    wallet
  );

  const tokenAddr = ethers.getAddress(cfg.address);
  const token = new ethers.Contract(tokenAddr, ERC20_ABI, wallet);

  const dec = await token.decimals();
  const ercSymbol = await token.symbol();
  const amount = ethers.parseUnits(amountStr, dec);

  console.log("Wallet :", wallet.address);
  console.log("Vault  :", DEPLOY.contracts.vault);
  console.log("Deposit:", amountStr, ercSymbol, tokenAddr);
  console.log();

  const paused = await vault.paused();
  const fresh = await oracle.isFresh(tokenAddr);
  const price = await oracle.getPrice(tokenAddr);

  console.log("Vault paused:", paused);
  console.log("Oracle fresh:", fresh);
  console.log("Price 8d    :", price.toString());

  if (paused) throw new Error("Vault is paused");
  if (!fresh) throw new Error("Oracle is stale");

  const walletBal = await token.balanceOf(wallet.address);
  if (walletBal < amount) {
    throw new Error(`Not enough ${symbol}. Wallet balance=${ethers.formatUnits(walletBal, dec)}`);
  }

  const preview = await vault.previewDeposit(tokenAddr, amount);

  console.log();
  console.log("Preview:");
  console.log("feeAmount     :", ethers.formatUnits(preview[0], dec));
  console.log("creditedAmount:", ethers.formatUnits(preview[1], dec));
  console.log("minted rINDEX :", ethers.formatUnits(preview[2], 18));
  console.log("price fresh   :", preview[4]);

  const allowance = await token.allowance(wallet.address, DEPLOY.contracts.vault);
  if (allowance < amount) {
    await waitTx(`Approve ${symbol}`, await token.approve(DEPLOY.contracts.vault, amount));
  } else {
    console.log("Allowance already enough.");
  }

  await waitTx(`Vault.deposit(${symbol},${amountStr})`, await vault.deposit(tokenAddr, amount));

  const userBal = await vault.userBalances(wallet.address, tokenAddr);
  const rBal = await receipt.balanceOf(wallet.address);
  const pending = await vault.pendingFees(tokenAddr);

  console.log();
  console.log("After deposit:");
  console.log("vault user", symbol, ":", ethers.formatUnits(userBal, dec));
  console.log("rINDEX balance:", ethers.formatUnits(rBal, 18));
  console.log("pending fee   :", ethers.formatUnits(pending, dec));
  console.log();
  console.log("✅ Deposit complete");
}

main().catch((err) => {
  console.error("\n❌ Deposit failed:");
  console.error(err.shortMessage || err.message || err);
  process.exit(1);
});
