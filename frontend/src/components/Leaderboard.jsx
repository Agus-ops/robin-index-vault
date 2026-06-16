import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { supabase } from "../lib/supabase";

const MEDALS = ["🥇", "🥈", "🥉"];

// 1. KOMPONEN PREVIEW
export function LeaderboardPreview({ go }) {
  const [top, setTop] = useState([]);

  useEffect(() => {
    supabase
      .from("leaderboard")
      .select("wallet, total")
      .order("total", { ascending: false })
      .limit(3)
      .then(({ data }) => {
        setTop((data || []).map((r) => ({ addr: r.wallet, total: r.total })));
      });
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

// 2. KOMPONEN UTAMA
export function Leaderboard() {
  const { address } = useAccount();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    supabase
      .from("leaderboard")
      .select("*")
      .order("total", { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          setError("Failed to load leaderboard.");
        } else {
          setEntries((data || []).map((r) => ({ addr: r.wallet, ...r })));
        }
        setLoading(false);
      });
  }, []);

  function short(addr) {
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  }

  const totalUsers  = entries.length;
  const totalPoints = entries.reduce((sum, e) => sum + (e.total || 0), 0);

  return (
    <section className="leaderboardPanel">
      <div className="sectionHead">
        <div>
          <h2>Leaderboard</h2>
          <p>Ranked by protocol activity points. Updated every 30 minutes.</p>
        </div>
      </div>

      {/* Stats 2 kotak */}
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
            <span>#</span>
            <span>Wallet</span>
            <span>Dep</span>
            <span>Wdr</span>
            <span>CI</span>
            <span>Pts</span>
          </div>
          {entries.map((e, i) => {
            const isMe = address && e.addr.toLowerCase() === address.toLowerCase();
            const rowClass = [
              "leaderboardRow",
              i === 0 ? "leaderboardGold" : "",
              i === 1 ? "leaderboardSilver" : "",
              i === 2 ? "leaderboardBronze" : "",
              isMe    ? "leaderboardMe" : "",
            ].filter(Boolean).join(" ");

            return (
              <div className={rowClass} key={e.addr}>
                <span className="leaderboardRank">{MEDALS[i] || i + 1}</span>
                <span className="leaderboardAddr">
                  {short(e.addr)}{isMe && <span className="leaderboardMeTag"> you</span>}
                </span>
                <span>{e.deposits  || 0}</span>
                <span>{e.withdraws || 0}</span>
                <span>{e.checkins  || 0}</span>
                <span className="leaderboardPoints">{e.total || 0}</span>
              </div>
            );
          })}
        </div>
      )}

      <p className="leaderboardNote">Points: Deposit +10 · Withdraw −5 · Daily Check-in +1</p>
    </section>
  );
}
