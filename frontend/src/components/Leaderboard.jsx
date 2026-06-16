import { useState, useEffect } from "react";
import { useAccount } from "wagmi";

const MEDALS = ["🥇", "🥈", "🥉"];

async function fetchPoints() {
  const res = await fetch("/points.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = await res.json();

  let arr = [];
  if (Array.isArray(raw)) {
    arr = raw;
  } else {
    arr = Object.entries(raw).map(([wallet, v]) => ({ wallet, ...v }));
  }

  return arr
    .map((r) => ({
      addr:      r.wallet || r.addr || "unknown",
      deposits:  r.deposits  || 0,
      withdraws: r.withdraws || 0,
      checkins:  r.checkins  || 0,
      total:     r.total     || 0,
    }))
    .sort((a, b) => b.total - a.total);
}

export function LeaderboardPreview({ go }) {
  const [top, setTop] = useState([]);

  useEffect(() => {
    fetchPoints()
      .then((arr) => setTop(arr.slice(0, 3)))
      .catch((e) => console.error("LeaderboardPreview:", e));
  }, []);

  function short(addr) {
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  }

  return (
    <article className="landingCard halfLanding leaderboardPreviewCard">
      <span className="cardKicker">Leaderboard</span>
      <h2>Top Rankings</h2>
      {top.length === 0 ? (
        <p className="leaderboardPreviewEmpty">No activity yet — be the first!</p>
      ) : (
        <div className="leaderboardPreviewList">
          {top.map((e, i) => (
            <div className="leaderboardPreviewRow" key={e.addr}>
              <span className="leaderboardPreviewRank">{MEDALS[i] || `#${i + 1}`}</span>
              <span className="leaderboardPreviewAddr">{short(e.addr)}</span>
              <span className="leaderboardPreviewPts">{e.total} pts</span>
            </div>
          ))}
        </div>
      )}
      <button className="secondaryBtn leaderboardPreviewBtn" onClick={() => go("rindex")}>
        View Rankings
      </button>
    </article>
  );
}

export function Leaderboard() {
  const { address } = useAccount();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    fetchPoints()
      .then((arr) => { setEntries(arr); setLoading(false); })
      .catch((e)  => { console.error("Leaderboard:", e); setError("Failed to load leaderboard."); setLoading(false); });
  }, []);

  function short(addr) {
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  }

  const totalUsers  = entries.length;
  const totalPoints = entries.reduce((sum, e) => sum + e.total, 0);

  return (
    <section className="leaderboardPanel">
      <div className="sectionHead">
        <div>
          <h2>Leaderboard</h2>
          <p>Ranked by protocol activity points. Updated every 30 minutes.</p>
        </div>
      </div>

      <div className="leaderboardStats">
        <div className="leaderboardStatCard">
          <span>Total Users</span>
          <strong>{loading ? "—" : totalUsers}</strong>
        </div>
        <div className="leaderboardStatCard">
          <span>Total Points</span>
          <strong>{loading ? "—" : totalPoints.toLocaleString()}</strong>
        </div>
      </div>

      {loading && <div className="rewardLoading">Loading leaderboard…</div>}
      {error   && <div className="rewardError">{error}</div>}

      {!loading && !error && entries.length === 0 && (
        <div className="leaderboardEmpty">No activity recorded yet. Be the first to deposit and check in!</div>
      )}

      {!loading && entries.length > 0 && (
        <div className="leaderboardList">
          <div className="leaderboardHeader">
            <span>#</span><span>Wallet</span><span>Dep</span><span>Wdr</span><span>CI</span><span>Pts</span>
          </div>
          {entries.map((e, i) => {
            const isMe = address && e.addr.toLowerCase() === address.toLowerCase();
            const rowClass = [
              "leaderboardRow",
              i === 0 ? "leaderboardGold"   : "",
              i === 1 ? "leaderboardSilver" : "",
              i === 2 ? "leaderboardBronze" : "",
              isMe    ? "leaderboardMe"     : "",
            ].filter(Boolean).join(" ");

            return (
              <div className={rowClass} key={e.addr}>
                <span className="leaderboardRank">{MEDALS[i] || i + 1}</span>
                <span className="leaderboardAddr">
                  {short(e.addr)}{isMe && <span className="leaderboardMeTag"> you</span>}
                </span>
                <span>{e.deposits}</span>
                <span>{e.withdraws}</span>
                <span>{e.checkins}</span>
                <span className="leaderboardPoints">{e.total}</span>
              </div>
            );
          })}
        </div>
      )}

      <p className="leaderboardNote">Points: Deposit +10 · Withdraw −5 · Daily Check-in +1</p>
    </section>
  );
}
