try { require("dotenv").config(); } catch {}

const { ethers } = require("ethers");

const RPC_URL =
  process.env.ROBIN_RPC ||
  process.env.ROBINHOOD_RPC_URL ||
  process.env.RPC_URL ||
  process.env.VITE_ROBINHOOD_RPC_URL;

if (!RPC_URL) throw new Error("Missing RPC env");

const isV6 = !!ethers.JsonRpcProvider;
const provider = isV6
  ? new ethers.JsonRpcProvider(RPC_URL)
  : new ethers.providers.JsonRpcProvider(RPC_URL);

const EXPLORER = "https://explorer.testnet.chain.robinhood.com/address/";

const contracts = [
  ["MockStockOracle", "0xFB22dF75fFD1E89b23f9b9727880a22C039350a9"],
  ["ReceiptToken / rINDEX", "0x032F80b841c1677ae188d34004a8F6e5F4f576B4"],
  ["FeeTreasury", "0xf5579396bFaEd22a14fF43d09eD490ae78784211"],
  ["RobinIndexVault", "0x1f51A1c104115fD24D3389428BC7Dbe370d3466b"],
  ["RewardDistributor", "0x30a6dDfCf8e1Fa11Ce5B2A9745c54123A74e0d15"],
];

const tokens = [
  ["TSLA", "Tesla Testnet Stock Token", "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E"],
  ["AMZN", "Amazon Testnet Stock Token", "0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02"],
  ["NFLX", "Netflix Testnet Stock Token", "0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93"],
  ["PLTR", "Palantir Testnet Stock Token", "0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0"],
  ["AMD", "AMD Testnet Stock Token", "0x71178BAc73cBeb415514eB542a8995b82669778d"],
  ["USDG", "USDG Testnet Stable Token", "0x7E955252E15c84f5768B83c41a71F9eba181802F"],
];

const ABI = [
  "function owner() view returns (address)",
  "function paused() view returns (bool)",
  "function vault() view returns (address)",
  "function vaultLocked() view returns (bool)",
  "function feeTreasury() view returns (address)",
  "function rewardDistributor() view returns (address)",
  "function receiptToken() view returns (address)",
  "function oracle() view returns (address)",
  "function treasury() view returns (address)",
  "function PRICE_DECIMALS() view returns (uint8)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function tokenConfigs(address) view returns (bool supported,bool isStock,bool isSettlement,uint8 decimals)",
  "function tokenConfig(address) view returns (bool enabled,uint256 absoluteWeeklyCap)",
  "function distributionThreshold(address) view returns (uint256)",
  "function bucketBalance(address,uint8) view returns (uint256)",
  "function pendingFees(address) view returns (uint256)",
];

function fmtAddr(v) {
  if (!v || typeof v !== "string") return v;
  return v;
}

async function tryCall(c, fn, args = []) {
  try {
    return await c[fn](...args);
  } catch {
    return null;
  }
}

function fmtUnitsSafe(v, decimals = 18) {
  if (v === null || v === undefined) return "-";
  try {
    return isV6 ? ethers.formatUnits(v, decimals) : ethers.utils.formatUnits(v, decimals);
  } catch {
    return String(v);
  }
}

async function main() {
  const net = await provider.getNetwork();
  const block = await provider.getBlockNumber();

  console.log("========================================");
  console.log(" Robin Index Vault Contract Audit");
  console.log("========================================");
  console.log("Chain ID :", net.chainId.toString());
  console.log("Block    :", block);
  console.log("");

  console.log("CORE CONTRACTS");
  console.log("------------------------------------------------------------");

  for (const [label, address] of contracts) {
    const code = await provider.getCode(address);
    const deployed = code && code !== "0x";
    const codeBytes = deployed ? (code.length - 2) / 2 : 0;
    const c = new ethers.Contract(address, ABI, provider);

    const owner = await tryCall(c, "owner");
    const paused = await tryCall(c, "paused");
    const vault = await tryCall(c, "vault");
    const vaultLocked = await tryCall(c, "vaultLocked");
    const feeTreasury = await tryCall(c, "feeTreasury");
    const rewardDistributor = await tryCall(c, "rewardDistributor");
    const receiptToken = await tryCall(c, "receiptToken");
    const oracle = await tryCall(c, "oracle");
    const treasury = await tryCall(c, "treasury");
    const priceDecimals = await tryCall(c, "PRICE_DECIMALS");

    console.log("");
    console.log(label);
    console.log("address       :", address);
    console.log("explorer      :", EXPLORER + address);
    console.log("deployed      :", deployed ? `YES (${codeBytes} bytes)` : "NO");
    if (owner !== null) console.log("owner         :", fmtAddr(owner));
    if (paused !== null) console.log("paused        :", paused);
    if (vault !== null) console.log("vault         :", fmtAddr(vault));
    if (vaultLocked !== null) console.log("vaultLocked   :", vaultLocked);
    if (feeTreasury !== null) console.log("feeTreasury   :", fmtAddr(feeTreasury));
    if (rewardDistributor !== null) console.log("rewards       :", fmtAddr(rewardDistributor));
    if (receiptToken !== null) console.log("receiptToken  :", fmtAddr(receiptToken));
    if (oracle !== null) console.log("oracle        :", fmtAddr(oracle));
    if (treasury !== null) console.log("treasury      :", fmtAddr(treasury));
    if (priceDecimals !== null) console.log("priceDecimals :", priceDecimals.toString());
  }

  console.log("");
  console.log("TOKENS / ASSETS");
  console.log("------------------------------------------------------------");

  const vault = new ethers.Contract("0x1f51A1c104115fD24D3389428BC7Dbe370d3466b", ABI, provider);
  const treasury = new ethers.Contract("0xf5579396bFaEd22a14fF43d09eD490ae78784211", ABI, provider);
  const rewards = new ethers.Contract("0x30a6dDfCf8e1Fa11Ce5B2A9745c54123A74e0d15", ABI, provider);

  for (const [sym, label, address] of tokens) {
    const t = new ethers.Contract(address, ABI, provider);
    const code = await provider.getCode(address);
    const deployed = code && code !== "0x";

    const name = await tryCall(t, "name");
    const symbol = await tryCall(t, "symbol");
    const decimals = await tryCall(t, "decimals");
    const totalSupply = await tryCall(t, "totalSupply");

    const vaultBal = await tryCall(t, "balanceOf", ["0x1f51A1c104115fD24D3389428BC7Dbe370d3466b"]);
    const treasuryBal = await tryCall(t, "balanceOf", ["0xf5579396bFaEd22a14fF43d09eD490ae78784211"]);
    const rewardBal = await tryCall(t, "balanceOf", ["0x30a6dDfCf8e1Fa11Ce5B2A9745c54123A74e0d15"]);

    const pending = await tryCall(vault, "pendingFees", [address]);

    let cfg = await tryCall(vault, "tokenConfigs", [address]);
    const rewardCfg = await tryCall(rewards, "tokenConfig", [address]);
    const threshold = await tryCall(treasury, "distributionThreshold", [address]);

    const d = decimals !== null ? Number(decimals) : 18;

    console.log("");
    console.log(`${sym} — ${label}`);
    console.log("address       :", address);
    console.log("explorer      :", EXPLORER + address);
    console.log("deployed      :", deployed ? "YES" : "NO");
    if (name !== null) console.log("name          :", name);
    if (symbol !== null) console.log("symbol        :", symbol);
    if (decimals !== null) console.log("decimals      :", decimals.toString());
    if (totalSupply !== null) console.log("totalSupply   :", fmtUnitsSafe(totalSupply, d));
    if (cfg !== null) {
      console.log("vault config  :", `supported=${cfg.supported ?? cfg[0]} stock=${cfg.isStock ?? cfg[1]} settlement=${cfg.isSettlement ?? cfg[2]} decimals=${String(cfg.decimals ?? cfg[3])}`);
    }
    console.log("vault balance :", fmtUnitsSafe(vaultBal, d));
    console.log("treasury bal  :", fmtUnitsSafe(treasuryBal, d));
    console.log("reward bal    :", fmtUnitsSafe(rewardBal, d));
    console.log("pending fee   :", fmtUnitsSafe(pending, d));
    if (threshold !== null) console.log("threshold     :", fmtUnitsSafe(threshold, d));
    if (rewardCfg !== null) {
      console.log("reward config :", `enabled=${rewardCfg.enabled ?? rewardCfg[0]} cap=${fmtUnitsSafe(rewardCfg.absoluteWeeklyCap ?? rewardCfg[1], d)}`);
    }
  }

  console.log("");
  console.log("DONE");
}

main().catch((err) => {
  console.error("FAILED:", err.shortMessage || err.message || err);
  process.exit(1);
});
