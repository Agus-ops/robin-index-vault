import fs from "fs";
import path from "path";
import "dotenv/config";
import { ethers } from "ethers";

const ROOT = process.cwd();
const DATA_FILE = path.join(ROOT, "data", "checkins.json");
const DEPLOY = JSON.parse(
  fs.readFileSync(path.join(ROOT, "deployments/robinhood-46630.json"), "utf8")
);

function artifact(name) {
  return JSON.parse(
    fs.readFileSync(path.join(ROOT, "artifacts", `${name}.json`), "utf8")
  );
}

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.ROBIN_RPC_PUBLIC);
  const vault = new ethers.Contract(
    DEPLOY.contracts.vault,
    artifact("RobinIndexVault").abi,
    provider
  );

  // Ambil event DailyRebalanceCheck dalam 7 hari terakhir
  const now = Math.floor(Date.now() / 1000);
  const fromBlock = now - 7 * 86400; // 7 hari terakhir (perkiraan blok)
  const filter = vault.filters.DailyRebalanceCheck();
  const events = await vault.queryFilter(filter, fromBlock);

  // Baca data lama
  let data = {};
  if (fs.existsSync(DATA_FILE)) {
    data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  }

  for (const ev of events) {
    const user = ev.args[0].toLowerCase();
    const timestamp = Number(ev.args[4]);
    const day = new Date(timestamp * 1000).toISOString().slice(0, 10); // YYYY-MM-DD

    if (!data[user]) data[user] = { days: {}, total: 0 };
    if (!data[user].days[day]) {
      data[user].days[day] = timestamp;
      data[user].total += 1;
    }
  }

  // Simpan
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  console.log(`✅ Check-ins tracked: ${events.length} events, ${Object.keys(data).length} users`);
}

main().catch((err) => {
  console.error("❌ Check-in tracker failed:", err.message);
  process.exit(1);
});
