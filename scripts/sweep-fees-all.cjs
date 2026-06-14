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

const formatUnits = (v, d) =>
  isV6 ? ethers.formatUnits(v, d) : ethers.utils.formatUnits(v, d);

const isZero = (v) =>
  typeof v === "bigint" ? v === 0n : v.isZero();

const VAULT = "0xD39a604Ddc92115C5cB0F70fc85AC5581D9e81A7";

const TOKENS = [
  ["TSLA", "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E"],
  ["AMZN", "0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02"],
  ["NFLX", "0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93"],
  ["PLTR", "0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0"],
  ["AMD",  "0x71178BAc73cBeb415514eB542a8995b82669778d"],
];

const VAULT_ABI = [
  "function paused() view returns (bool)",
  "function pendingFees(address token) view returns (uint256)",
  "function sweepFees(address token)"
];

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)"
];

async function waitTx(label, tx) {
  console.log(`${label}: ${tx.hash}`);
  const rc = await tx.wait();
  console.log(`${label} confirmed in block ${rc.blockNumber}`);
}

async function main() {
  const net = await provider.getNetwork();
  const vault = new ethers.Contract(VAULT, VAULT_ABI, wallet);

  console.log("Wallet:", wallet.address);
  console.log("Chain :", net.chainId.toString());
  console.log("Vault :", VAULT);

  const paused = await vault.paused();
  if (paused) throw new Error("Vault is paused");

  for (const [sym, addr] of TOKENS) {
    const token = new ethers.Contract(addr, ERC20_ABI, provider);
    const decimals = await token.decimals();

    const pending = await vault.pendingFees(addr);

    console.log(`\n=== ${sym} ===`);
    console.log("Pending fee:", formatUnits(pending, decimals));

    if (isZero(pending)) {
      console.log("SKIP: no pending fee");
      continue;
    }

    await waitTx(`sweepFees ${sym}`, await vault.sweepFees(addr));

    const after = await vault.pendingFees(addr);
    console.log("Pending after:", formatUnits(after, decimals));
  }

  console.log("\n✅ Sweep complete. Run: npm run check:v0.5.0");
}

main().catch((err) => {
  console.error("\n❌ Failed:", err.shortMessage || err.message || err);
  process.exit(1);
});
