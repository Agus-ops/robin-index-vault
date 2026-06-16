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

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

const STOCKS = ["TSLA", "AMZN", "NFLX", "PLTR", "AMD"];
const PRICE_SCALE = 100000000n;

const EXEC = process.env.EXEC === "1";
const FORCE = process.env.FORCE === "1";
const MAX_PRICE_CHANGE_BPS = BigInt(process.env.MAX_PRICE_CHANGE_BPS || "1000"); // 10%
const SWEEP_THRESHOLD = process.env.SWEEP_THRESHOLD || "0.00002";

function toPrice8(price) {
  const priceStr = String(price);

  if (!/^\d+(\.\d+)?$/.test(priceStr)) {
    throw new Error(`Invalid price: ${priceStr}`);
  }

  const [whole, fracRaw = ""] = priceStr.split(".");
  const frac = (fracRaw + "00000000").slice(0, 8);

  return BigInt(whole) * PRICE_SCALE + BigInt(frac);
}

function fromPrice8(value) {
  return Number(ethers.formatUnits(value || 0n, 8));
}

function priceChangeBps(oldPrice8, newPrice8) {
  if (!oldPrice8 || oldPrice8 <= 0n) return 0n;

  const diff = oldPrice8 > newPrice8
    ? oldPrice8 - newPrice8
    : newPrice8 - oldPrice8;

  return (diff * 10000n) / oldPrice8;
}

async function waitTx(label, tx) {
  console.log(`TX ${label}: ${tx.hash}`);
  const rc = await tx.wait();
  console.log(`✅ ${label} mined block=${rc.blockNumber} gas=${rc.gasUsed}`);
  return rc;
}

async function fetchTwelveDataPrice(symbol) {
  const key = process.env.TWELVEDATA_API_KEY;

  if (!key) throw new Error("Missing TWELVEDATA_API_KEY in .env");

  const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`TwelveData HTTP ${res.status} for ${symbol}`);
  }

  const data = await res.json();

  if (data.status === "error") {
    throw new Error(`TwelveData error for ${symbol}: ${data.message}`);
  }

  const price = Number(data.price);

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Invalid TwelveData price for ${symbol}: ${JSON.stringify(data)}`);
  }

  return {
    price,
    raw: data,
  };
}

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.ROBIN_RPC);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const oracle = new ethers.Contract(
    DEPLOY.contracts.oracle,
    artifact("MockStockOracle").abi,
    wallet
  );

  const vault = new ethers.Contract(
    DEPLOY.contracts.vault,
    artifact("RobinIndexVault").abi,
    wallet
  );

  const treasury = new ethers.Contract(
    DEPLOY.contracts.treasury,
    artifact("FeeTreasury").abi,
    wallet
  );

  const network = await provider.getNetwork();

  console.log("========================================");
  console.log(" Robin Index Vault Oracle Keeper");
  console.log("========================================");
  console.log("Mode      :", EXEC ? "EXECUTE" : "DRY-RUN");
  console.log("Force     :", FORCE);
  console.log("Chain ID  :", network.chainId.toString());
  console.log("Wallet    :", wallet.address);
  console.log("Oracle    :", DEPLOY.contracts.oracle);
  console.log("Vault     :", DEPLOY.contracts.vault);
  console.log("Treasury  :", DEPLOY.contracts.treasury);
  console.log("Max change:", `${Number(MAX_PRICE_CHANGE_BPS) / 100}%`);
  console.log("Sweep min :", SWEEP_THRESHOLD);
  console.log();

  for (const symbol of STOCKS) {
    console.log(`================ ${symbol} ================`);

    const cfg = DEPLOY.tokens[symbol];

    if (!cfg) {
      console.log("⚠️ Missing token config, skipping.");
      continue;
    }

    const tokenAddr = ethers.getAddress(cfg.address);
    const token = new ethers.Contract(tokenAddr, ERC20_ABI, wallet);
    const dec = await token.decimals();

    const [priceData, fresh, pending, bucketsBefore] = await Promise.all([
      oracle.getPriceData(tokenAddr),
      oracle.isFresh(tokenAddr),
      vault.pendingFees(tokenAddr),
      treasury.getBuckets(tokenAddr),
    ]);

    const oldPrice8 = BigInt(priceData[0]);
    const oldPrice = fromPrice8(oldPrice8);

    let quote;

    try {
      quote = await fetchTwelveDataPrice(symbol);
    } catch (err) {
      console.log("❌ Finnhub fetch failed:", err.message);
      continue;
    }

    const newPrice8 = toPrice8(quote.price.toFixed(8));
    const bps = priceChangeBps(oldPrice8, newPrice8);
    const updateAllowed = FORCE || oldPrice8 === 0n || bps <= MAX_PRICE_CHANGE_BPS;
    const priceChanged = oldPrice8 !== newPrice8;

    console.log("Oracle price :", `$${oldPrice}`);
    console.log("API price    :", `$${quote.price}`);
    console.log("Fresh        :", fresh);
    console.log("Change       :", `${Number(bps) / 100}%`);
    console.log("Price action :", priceChanged ? (updateAllowed ? "update allowed" : "skip: large move") : "no change");

    if (priceChanged && updateAllowed) {
      if (EXEC) {
        await waitTx(
          `Oracle.setPrice(${symbol})`,
          await oracle.setPrice(tokenAddr, newPrice8)
        );
      } else {
        console.log(`DRY-RUN: would update ${symbol} oracle to $${quote.price}`);
      }
    } else if (priceChanged && !updateAllowed) {
      console.log("⚠️ Skipped oracle update. Use FORCE=1 only after manual review.");
    }

    const threshold = ethers.parseUnits(SWEEP_THRESHOLD, dec);
    console.log("Pending fee  :", ethers.formatUnits(pending, dec), symbol);

    if (pending >= threshold) {
      if (EXEC) {
        await waitTx(
          `Vault.sweepFees(${symbol})`,
          await vault.sweepFees(tokenAddr)
        );
      } else {
        console.log(`DRY-RUN: would sweep ${ethers.formatUnits(pending, dec)} ${symbol}`);
      }
    } else {
      console.log("Sweep action : skip, below threshold");
    }

    const [pendingAfter, bucketsAfter] = await Promise.all([
      vault.pendingFees(tokenAddr),
      treasury.getBuckets(tokenAddr),
    ]);

    console.log("Pending now  :", ethers.formatUnits(pendingAfter, dec), symbol);
    console.log("Buckets:");
    console.log("  reserve :", ethers.formatUnits(bucketsAfter[0], dec));
    console.log("  rewards :", ethers.formatUnits(bucketsAfter[1], dec));
    console.log("  router  :", ethers.formatUnits(bucketsAfter[2], dec));
    console.log("  operator:", ethers.formatUnits(bucketsAfter[3], dec));
    console.log("  received:", ethers.formatUnits(bucketsAfter[4], dec));

    const changedBuckets =
      bucketsAfter[4] !== bucketsBefore[4] ||
      pendingAfter !== pending;

    if (changedBuckets) {
      console.log("Treasury state changed.");
    }

    console.log();
  }

  console.log("✅ Keeper complete");
}

main().catch((err) => {
  console.error("\n❌ Keeper failed:");
  console.error(err.shortMessage || err.message || err);
  process.exit(1);
});
