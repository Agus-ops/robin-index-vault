import { supabase } from "./supabase";

// action: "deposit" | "withdraw" | "checkin"
export async function addPoints(wallet, action) {
  const w = wallet.toLowerCase();

  // Ambil data existing
  const { data: existing } = await supabase
    .from("leaderboard")
    .select("*")
    .eq("wallet", w)
    .single();

  const curr = existing || { wallet: w, deposits: 0, withdraws: 0, checkins: 0, total: 0 };

  if (action === "deposit")  { curr.deposits  += 1; curr.total += 10; }
  if (action === "withdraw") { curr.withdraws += 1; curr.total = Math.max(0, curr.total - 5); }
  if (action === "checkin")  { curr.checkins  += 1; curr.total += 1; }

  await supabase.from("leaderboard").upsert({ ...curr, wallet: w });
}
