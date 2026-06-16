import { TOKENS } from "../contracts/tokens";
import RewardPanel from "./RewardPanel"; // Memanggil file RewardPanel bawaan Anda

// Sub-komponen Bucket yang dipakai oleh TreasuryPanel
function Bucket({ label, pct }) {
  return (
    <div className="bucketBarWrapper">
      <div className="bucketBarLabel">
        <span>{label}</span>
        <strong>{pct}%</strong>
      </div>
      <div className="bucketBarTrack">
        <div className="bucketBarFill" style={{ width: `${pct}%` }}></div>
      </div>
    </div>
  );
}

export function TreasuryPanel({ 
  data, 
  isOperator, 
  isConnected, 
  isRightChain, 
  onSweepFees, 
  sweepingSymbol 
}) {

  // Formatting helper internal
  function formatAmount(amount, decimals, precision = 4) {
    if (!amount) return "0.00";
    const base = 10n ** BigInt(decimals);
    const integerPart = amount / base;
    const fractionalPart = amount % base;
    let fractionStr = fractionalPart.toString().padStart(decimals, "0");
    fractionStr = fractionStr.slice(0, precision);
    return `${integerPart}.${fractionStr}`;
  }

  return (
    <section id="treasury" className="panel treasuryPanel">
      <div className="sectionHead">
        <div>
          <h2>Treasury & Rewards</h2>
          <p>Protocol fees are split into transparent buckets. Rewards are fee-funded only.</p>
        </div>
      </div>

      <div className="treasurySplitGrid">
        <div>
          <span>Protocol Reserve</span>
          <strong>50%</strong>
          <em>Safety reserve</em>
        </div>
        <div>
          <span>User Rewards Pool</span>
          <strong>30%</strong>
          <em>Fee-funded rewards</em>
        </div>
        <div>
          <span>Router Liquidity</span>
          <strong>15%</strong>
          <em>Routing support</em>
        </div>
        <div>
          <span>Admin Ops</span>
          <strong>5%</strong>
          <em>Operations bucket</em>
        </div>
      </div>

      <div className="bucketBars">
        <Bucket label="Protocol Reserve" pct={50} />
        <Bucket label="User Rewards Pool" pct={30} />
        <Bucket label="Router Liquidity" pct={15} />
        <Bucket label="Admin Ops" pct={5} />
      </div>

      <div className="sectionHead treasuryTokenHead">
        <div>
          <h2>Live Token Buckets</h2>
          <p>Per-asset fee state from the verified treasury contract.</p>
        </div>
      </div>

      <div className="treasuryTokenGrid">
        {(TOKENS || []).map((token) => {
          const buckets = data?.buckets?.[token.symbol] || [0n, 0n, 0n, 0n];
          const pendingForSweep = data?.pendingFees?.[token.symbol] || 0n;

          return (
            <article className="treasuryTokenCard" key={token.symbol}>
              <div className="treasuryTokenTop">
                <strong>{token.symbol}</strong>
                <span>{token.name}</span>
              </div>

              <div className="treasuryMetricRows">
                <div>
                  <span>Pending fees</span>
                  <strong>{formatAmount(pendingForSweep, token.decimals, 6)} {token.symbol}</strong>
                </div>
                <div>
                  <span>Total deposits</span>
                  <strong>{formatAmount(data?.totalDeposits?.[token.symbol] || 0n, token.decimals, 4)} {token.symbol}</strong>
                </div>
              </div>

              {isOperator && (
                <div className="treasuryOperatorRow">
                  <button
                    className="secondaryBtn"
                    disabled={!isConnected || !isRightChain || pendingForSweep <= 0n || sweepingSymbol === token.symbol}
                    onClick={() => onSweepFees?.(token)}
                  >
                    {sweepingSymbol === token.symbol ? "Sweeping..." : pendingForSweep > 0n ? "Sweep Fees" : "No Fees"}
                  </button>
                  <span>Operator only</span>
                </div>
              )}

              <div className="treasuryBucketMini">
                <div><span>Reserve</span><strong>{formatAmount(buckets[0], token.decimals, 6)}</strong></div>
                <div><span>Rewards</span><strong>{formatAmount(buckets[1], token.decimals, 6)}</strong></div>
                <div><span>Router</span><strong>{formatAmount(buckets[2], token.decimals, 6)}</strong></div>
                <div><span>Operator</span><strong>{formatAmount(buckets[3], token.decimals, 6)}</strong></div>
              </div>
            </article>
          );
        })}
      </div>

      {/* Memanggil Panel Reward bawaan asli */}
      <RewardPanel />

      <p className="fineprint">
        Rewards are distributed only from collected protocol fees. This page does not imply APY,
        APR, guaranteed yield, or real stock ownership.
      </p>
    </section>
  );
}
