import fs from "fs";
import path from "path";
import "dotenv/config";

const LAST_CLAIM_FILE = path.join(process.cwd(), "data", "usdg_faucet_last.json");
const FAUCET_URL = "https://api.sandbox.paxos.com/v2/treasury/faucet/transfers";
const WALLET = process.env.WALLET_ADDRESS || "0xD2F9f6381Fb5f00c2fC606553592dB28309c019d";

// Cooldown antar klaim faucet
const COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 jam

async function main() {
  const now = new Date();

  // Cek kapan klaim terakhir
  let lastClaim = 0;
  if (fs.existsSync(LAST_CLAIM_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(LAST_CLAIM_FILE, "utf8"));
      lastClaim = data.timestamp || 0;
    } catch {}
  }

  const elapsedMs = now.getTime() - lastClaim;
  if (elapsedMs < COOLDOWN_MS) {
    const remainingMs = COOLDOWN_MS - elapsedMs;
    const remainingH = Math.floor(remainingMs / 3600000);
    const remainingM = Math.floor((remainingMs % 3600000) / 60000);
    console.log(`⏳ USDG faucet cooldown 4 jam. ${remainingH}j ${remainingM}m lagi.`);
    return;
  }

  console.log("🔄 Mengklaim USDG faucet (100 USDG)...");
  try {
    const res = await fetch(FAUCET_URL, {
      method: "POST",
      headers: {
        "Origin": "https://faucet.paxos.com",
        "Referer": "https://faucet.paxos.com/",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token: "USDG",
        network: "ROBINHOOD",
        address: WALLET,
      }),
    });

    const text = await res.text();
    console.log(`  Status: ${res.status} ${res.statusText}`);
    console.log(`  Response: ${text}`);

    if (res.status === 200 || res.status === 201) {
      fs.mkdirSync(path.dirname(LAST_CLAIM_FILE), { recursive: true });
      fs.writeFileSync(LAST_CLAIM_FILE, JSON.stringify({
        timestamp: Date.now(),
        response: text,
      }));
      console.log("✅ USDG faucet berhasil diklaim (100 USDG)");
    } else {
      console.warn("⚠️ USDG faucet gagal:", text);
    }
  } catch (err) {
    console.error("❌ USDG faucet error:", err.message);
  }
}

main();
