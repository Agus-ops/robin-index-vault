try { require("dotenv").config(); } catch {}

const { ethers } = require("ethers");

const RPC_URL =
  process.env.ROBIN_RPC ||
  process.env.ROBINHOOD_RPC_URL ||
  process.env.RPC_URL ||
  process.env.VITE_ROBINHOOD_RPC_URL;

const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!RPC_URL) throw new Error("Missing RPC env: ROBIN_RPC or RPC_URL");
if (!PRIVATE_KEY) throw new Error("Missing PRIVATE_KEY env");

const isV6 = !!ethers.JsonRpcProvider;
const provider = isV6
  ? new ethers.JsonRpcProvider(RPC_URL)
  : new ethers.providers.JsonRpcProvider(RPC_URL);

const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

const parseUnits = (v, d) =>
  isV6 ? ethers.parseUnits(v, d) : ethers.utils.parseUnits(v, d);

const formatUnits = (v, d) =>
  isV6 ? ethers.formatUnits(v, d) : ethers.utils.formatUnits(v, d);

const VAULT = "0x1f51A1c104115fD24D3389428BC7Dbe370d3466b";
const RECEIPT = "0x032F80b841c1677ae188d34004a8F6e5F4f576B4";

const TOKENS = {
  TSLA: ["0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E", 18],
  AMZN: ["0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02", 18],
  NFLX: ["0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93", 18],
  PLTR: ["0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0", 18],
  AMD:  ["0x71178BAc73cBeb415514eB542a8995b82669778d", 18],
};

const VAULT_ABI = [
  "function paused() view returns (bool)",
  "function withdraw(address token,uint256 amount)",
  "function userBalances(address user,address token) view returns (uint256)",
  "function userReceiptByToken(address user,address token) view returns (uint256)",
  "function pendingFees(address token) view returns (uint256)"
];

const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

const RECEIPT_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function totalSupply() view returns (uint256)"
];

async function snapshot(label, token, tokenAddr, decimals, vault, receipt) {
  const walletToken = await token.balanceOf(wallet.address);
  const vaultToken = await token.balanceOf(VAULT);
  const ledger = await vault.userBalances(wallet.address, tokenAddr);
  const pending = await vault.pendingFees(tokenAddr);
  const receiptBal = await receipt.balanceOf(wallet.address);
  const receiptSupply = await receipt.totalSupply();
  const receiptByToken = await vault.userReceiptByToken(wallet.address, tokenAddr);

  console.log(`\n== ${label} ==`);
  console.log("Wallet token     :", formatUnits(walletToken, decimals));
  console.log("Vault token      :", formatUnits(vaultToken, decimals));
  console.log("Vault ledger     :", formatUnits(ledger, decimals));
  console.log("Pending fee      :", formatUnits(pending, decimals));
  console.log("rINDEX wallet    :", formatUnits(receiptBal, 18));
  console.log("rINDEX supply    :", formatUnits(receiptSupply, 18));
  console.log("rINDEX by token  :", formatUnits(receiptByToken, 18));
}

async function main() {
  const sym = (process.argv[2] || "TSLA").toUpperCase();
  const amountHuman = process.argv[3] || "0.01";

  if (!TOKENS[sym]) {
    throw new Error(`Unknown token ${sym}. Use: ${Object.keys(TOKENS).join(", ")}`);
  }

  const [tokenAddr] = TOKENS[sym];

  const net = await provider.getNetwork();
  const vault = new ethers.Contract(VAULT, VAULT_ABI, wallet);
  const token = new ethers.Contract(tokenAddr, ERC20_ABI, wallet);
  const receipt = new ethers.Contract(RECEIPT, RECEIPT_ABI, wallet);

  const decimals = await token.decimals();
  const amount = parseUnits(amountHuman, decimals);

  console.log("Wallet :", wallet.address);
  console.log("Chain  :", net.chainId.toString());
  console.log("Token  :", sym, tokenAddr);
  console.log("Amount :", amountHuman, sym);

  const paused = await vault.paused();
  if (paused) throw new Error("Vault is paused");

  const ledger = await vault.userBalances(wallet.address, tokenAddr);
  if (ledger < amount) {
    throw new Error(`Not enough vault ledger. Have ${formatUnits(ledger, decimals)} ${sym}`);
  }

  await snapshot("BEFORE", token, tokenAddr, decimals, vault, receipt);

  console.log(`\nWithdrawing ${amountHuman} ${sym}...`);
  const tx = await vault.withdraw(tokenAddr, amount);
  console.log("Withdraw tx:", tx.hash);
  const rc = await tx.wait();
  console.log("Confirmed block:", rc.blockNumber);

  await snapshot("AFTER", token, tokenAddr, decimals, vault, receipt);

  console.log("\n✅ Withdraw smoke complete");
  console.log("Next: npm run status && npm run invariant");
}

main().catch((err) => {
  console.error("\n❌ Failed:", err.shortMessage || err.message || err);
  process.exit(1);
});
