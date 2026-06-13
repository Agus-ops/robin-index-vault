try { require("dotenv").config(); } catch {}

const { ethers } = require("ethers");

const RPC_URL =
  process.env.ROBIN_RPC ||
  process.env.ROBINHOOD_RPC_URL ||
  process.env.RPC_URL ||
  process.env.VITE_ROBINHOOD_RPC_URL;

const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!RPC_URL) throw new Error("Missing RPC URL env: ROBIN_RPC or ROBINHOOD_RPC_URL or RPC_URL");
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

const lt = (a, b) =>
  typeof a === "bigint" ? a < b : a.lt(b);

const VAULT = "0x1f51A1c104115fD24D3389428BC7Dbe370d3466b";

const TOKENS = [
  ["TSLA", "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E"],
  ["AMZN", "0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02"],
  ["NFLX", "0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93"],
  ["PLTR", "0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0"],
  ["AMD",  "0x71178BAc73cBeb415514eB542a8995b82669778d"],
];

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)"
];

const VAULT_ABI = [
  "function deposit(address token,uint256 amount) external",
  "function userBalances(address user,address token) view returns (uint256)",
  "function userReceiptByToken(address user,address token) view returns (uint256)"
];

async function main() {
  const net = await provider.getNetwork();
  console.log("Wallet :", wallet.address);
  console.log("Chain  :", net.chainId.toString());
  console.log("Vault  :", VAULT);
  console.log("Amount : 1 token each");
  console.log("");

  const vault = new ethers.Contract(VAULT, VAULT_ABI, wallet);

  for (const [sym, addr] of TOKENS) {
    const token = new ethers.Contract(addr, ERC20_ABI, wallet);
    const decimals = await token.decimals();
    const amount = parseUnits("1", decimals);

    const bal = await token.balanceOf(wallet.address);
    console.log(`\n=== ${sym} ===`);
    console.log("Wallet balance:", formatUnits(bal, decimals));

    if (lt(bal, amount)) {
      console.log(`SKIP ${sym}: balance kurang dari 1`);
      continue;
    }

    const allowance = await token.allowance(wallet.address, VAULT);
    console.log("Allowance     :", formatUnits(allowance, decimals));

    if (lt(allowance, amount)) {
      console.log(`Approving ${sym}...`);
      const tx = await token.approve(VAULT, amount);
      console.log("Approve tx    :", tx.hash);
      await tx.wait();
    } else {
      console.log("Approve       : already enough");
    }

    console.log(`Depositing 1 ${sym}...`);
    const tx2 = await vault.deposit(addr, amount);
    console.log("Deposit tx    :", tx2.hash);
    await tx2.wait();

    const userBal = await vault.userBalances(wallet.address, addr);
    const receipt = await vault.userReceiptByToken(wallet.address, addr);

    console.log("Vault ledger  :", formatUnits(userBal, decimals));
    console.log("Receipt part  :", formatUnits(receipt, 18));
  }

  console.log("\n✅ Done. Run: npm run status && npm run invariant");
}

main().catch((err) => {
  console.error("\n❌ Failed:", err.shortMessage || err.message || err);
  process.exit(1);
});
