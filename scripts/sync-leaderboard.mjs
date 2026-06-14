import { readFileSync } from "fs";
import { supabase } from "./supabase-client.mjs";

const POINTS_FILE = "/opt/robin-index-vault/data/points.json";

async function syncLeaderboard() {
  console.log("[sync-leaderboard] Starting sync...");

  let points = {};
  try {
    points = JSON.parse(readFileSync(POINTS_FILE, "utf8"));
  } catch {
    console.log("[sync-leaderboard] points.json empty or not found, skipping.");
    return;
  }

  const entries = Object.entries(points);
  if (entries.length === 0) {
    console.log("[sync-leaderboard] No data to sync.");
    return;
  }

  const rows = entries.map(([wallet, v]) => ({
    wallet: wallet.toLowerCase(),
    deposits: v.deposits || 0,
    withdraws: v.withdraws || 0,
    checkins: v.checkins || 0,
    total: v.total || 0,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("leaderboard")
    .upsert(rows, { onConflict: "wallet" });

  if (error) {
    console.error("[sync-leaderboard] Error:", error.message);
  } else {
    console.log(`[sync-leaderboard] Synced ${rows.length} entries.`);
  }
}

syncLeaderboard();
