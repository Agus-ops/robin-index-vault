import fs from "fs";
import path from "path";
import "dotenv/config";
import { ethers } from "ethers";

const ROOT = process.cwd();
const DATA_FILE = path.join(ROOT, "data", "points.json");
const SNAPSHOT_FILE = path.join(ROOT, "data", "points_snapshot.json");
const DEPLOY = JSON.parse(
  fs.readFileSync(path.join(ROOT, "deployments/robinhood-46630.json"), "utf8")
);

function artifact(name) {
  return JSON.parse(
    fs.readFileSync(path.join(ROOT, "artifacts", `${name}.json`), "utf8")
  );
}

const TOKENS = ["TSLA", "AMZN", "NFLX", "PLTR", "AMD"];
const USERS = (process.env.WATCH_USERS || "").split(",").map(s => s.trim()).filter(Boolean);

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.ROBIN_RPC_PUBLIC);
  const vault = new ethers.Contract(
    DEPLOY.contracts.vault,
    artifact("RobinIndexVault").abi,
    provider
  );

  // Baca snapshot sebelumnya
  let snapshot = {};
  if (fs.existsSync(SNAPSHOT_FILE)) {
    snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8"));
  }

  // Baca points lama
  let points = {};
  if (fs.existsSync(DATA_FILE)) {
    points = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  }

  const newSnapshot = {};

  for (const userAddr of USERS) {
    const user = userAddr.toLowerCase();
    if (!points[user]) points[user] = { deposits: 0, withdraws: 0, checkins: 0, total: 0 };
    if (!snapshot[user]) snapshot[user] = {};

    let totalNewDeposits = 0;
    let totalNewWithdraws = 0;

    for (const symbol of TOKENS) {
      const tokenAddr = DEPLOY.tokens[symbol].address;
      try {
        const deposited = await vault.userTotalDeposited(user, tokenAddr);
        const withdrawn = await vault.userTotalWithdrawn(user, tokenAddr);

        const prevDep = BigInt(snapshot[user]?.[`dep_${symbol}`] || "0");
        const prevWdr = BigInt(snapshot[user]?.[`wdr_${symbol}`] || "0");

        // Hitung delta
        if (deposited > prevDep) totalNewDeposits += 1;
        if (withdrawn > prevWdr) totalNewWithdraws += 1;

        // Simpan untuk snapshot berikutnya
        if (!newSnapshot[user]) newSnapshot[user] = {};
        newSnapshot[user][`dep_${symbol}`] = deposited.toString();
        newSnapshot[user][`wdr_${symbol}`] = withdrawn.toString();
      } catch (e) {
        console.warn(`  ⚠️ Error reading ${symbol} for ${user}:`, e.shortMessage || e.message);
      }
    }

    // Check-in
    try {
      const lastCheckIn = await vault.lastRebalanceAt(user);
      const prevCheckIn = BigInt(snapshot[user]?.checkin || "0");
      if (lastCheckIn > prevCheckIn) {
        points[user].checkins += 1;
        newSnapshot[user].checkin = lastCheckIn.toString();
      } else if (snapshot[user]?.checkin) {
        newSnapshot[user].checkin = snapshot[user].checkin;
      } else {
        newSnapshot[user].checkin = lastCheckIn.toString();
      }
    } catch (e) {
      console.warn(`  ⚠️ Error reading check-in for ${user}:`, e.shortMessage || e.message);
    }

    // Akumulasi poin
    points[user].deposits += totalNewDeposits;
    points[user].withdraws += totalNewWithdraws;
    points[user].total = Math.max(0, (points[user].deposits * 10) + (points[user].checkins * 1) - (points[user].withdraws * 5));
  }

  // Simpan snapshot baru
  fs.mkdirSync(path.dirname(SNAPSHOT_FILE), { recursive: true });
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(newSnapshot, null, 2));
  console.log(`✅ Snapshot updated: ${Object.keys(newSnapshot).length} users`);

  // Simpan points
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(points, null, 2));
  console.log(`✅ Points tracked: ${Object.keys(points).length} users`);

  // Kirim ke Supabase
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

  if (SUPABASE_URL && SUPABASE_KEY) {
    for (const [wallet, data] of Object.entries(points)) {
      try {
        const body = {
          wallet,
          deposits: data.deposits,
          withdraws: data.withdraws,
          checkins: data.checkins,
          total: data.total,
        };

        // Cek apakah sudah ada di Supabase
        const check = await fetch(`${SUPABASE_URL}/rest/v1/leaderboard?wallet=eq.${encodeURIComponent(wallet)}`, {
          headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
        });
        const existing = await check.json();

        if (existing && existing.length > 0) {
          await fetch(`${SUPABASE_URL}/rest/v1/leaderboard?wallet=eq.${encodeURIComponent(wallet)}`, {
            method: "PATCH",
            headers: {
              "apikey": SUPABASE_KEY,
              "Authorization": `Bearer ${SUPABASE_KEY}`,
              "Content-Type": "application/json",
              "Prefer": "return=minimal",
            },
            body: JSON.stringify(body),
          });
          console.log(`  ✅ Updated Supabase: ${wallet}`);
        } else {
          await fetch(`${SUPABASE_URL}/rest/v1/leaderboard`, {
            method: "POST",
            headers: {
              "apikey": SUPABASE_KEY,
              "Authorization": `Bearer ${SUPABASE_KEY}`,
              "Content-Type": "application/json",
              "Prefer": "return=minimal",
            },
            body: JSON.stringify(body),
          });
          console.log(`  ✅ Inserted Supabase: ${wallet}`);
        }
      } catch (e) {
        console.warn(`  ⚠️ Supabase error for ${wallet}:`, e.message);
      }
    }
  }
}

main().catch((err) => {
  console.error("❌ Points tracker failed:", err.message);
  process.exit(1);
});
