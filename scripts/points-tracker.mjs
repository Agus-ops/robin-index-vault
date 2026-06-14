import fs from "fs";
import path from "path";
import "dotenv/config";
import { ethers } from "ethers";

const ROOT = process.cwd();
const DATA_FILE = path.join(ROOT, "data", "points.json");
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

  const points = {};

  function ensure(user) {
    if (!points[user]) points[user] = { deposits: 0, withdraws: 0, checkins: 0, total: 0 };
  }

  // Hitung deposit events
  const depositFilter = vault.filters.Deposited();
  const depositEvents = await vault.queryFilter(depositFilter, 0, "latest");
  for (const ev of depositEvents) {
    const user = ev.args.user.toLowerCase();
    ensure(user);
    points[user].deposits += 1;
  }

  // Hitung withdraw events
  const withdrawFilter = vault.filters.Withdrawn();
  const withdrawEvents = await vault.queryFilter(withdrawFilter, 0, "latest");
  for (const ev of withdrawEvents) {
    const user = ev.args.user.toLowerCase();
    ensure(user);
    points[user].withdraws += 1;
  }

  // Hitung checkin events
  const checkinFilter = vault.filters.DailyRebalanceCheck();
  const checkinEvents = await vault.queryFilter(checkinFilter, 0, "latest");
  for (const ev of checkinEvents) {
    const user = ev.args.user.toLowerCase();
    ensure(user);
    points[user].checkins += 1;
  }

  // Hitung total
  for (const user of Object.keys(points)) {
    const p = points[user];
    p.total = (p.deposits * 10) - (p.withdraws * 5) + (p.checkins * 1);
    if (p.total <= 0) delete points[user];
  }

  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(points, null, 2));
  console.log(`✅ Points tracked: ${Object.keys(points).length} users`);
}

main().catch((err) => {
  console.error("❌ Points tracker failed:", err.message);
  process.exit(1);
});
