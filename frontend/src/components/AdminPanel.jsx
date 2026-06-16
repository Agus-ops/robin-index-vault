import { formatUnits } from "viem";
import { TOKENS } from "../contracts/tokens";

// Helper internal untuk memotong alamat wallet agar rapi
function shortAddress(addr) {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function AdminPanel({ data, loading, address, isOperator, focus, onSweepFees, sweepingSymbol }) {
  
  // Formatting helper internal
  function formatUsd(val) {
    if (!val) return "$0.00";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);
  }

  function formatAmount(amount, decimals, precision = 4) {
    if (!amount) return "0.00";
    const base = 10n ** BigInt(decimals);
    const integerPart = amount / base;
    const fractionalPart = amount % base;
    let fractionStr = fractionalPart.toString().padStart(decimals, "0");
    fractionStr = fractionStr.slice(0, precision);
    return `${integerPart}.${fractionStr}`;
  }

  if (!isOperator) {
    return (
      <section className="panel adminPanel">
        <div className="sectionHead">
          <div>
            <h2>Access Locked</h2>
            <p>Admin controls are hidden unless the connected wallet is an authorized operator.</p>
          </div>
          <span className="dangerPill">Locked</span>
        </div>
      </section>
    );
  }

  const readStatus = data?.readIssue ? "RPC retry" : loading ? "Reading" : "Live";
  const vaultState = data?.paused ? "Paused" : "Active";
  
  const totalPendingUsd = TOKENS.reduce((sum, token) => {
    const raw = data?.pendingFees?.[token.symbol] || 0n;
    const amount = Number(formatUnits(raw, token.decimals));
    const price = data?.prices?.[token.symbol] || token.fallbackPrice || 0;
    return Number.isFinite(amount) && Number.isFinite(price) ? sum + amount * price : sum;
  }, 0);

  const totalDepositsUsd = TOKENS.reduce((sum, token) => {
    const raw = data?.totalDeposits?.[token.symbol] || 0n;
    const amount = Number(formatUnits(raw, token.decimals));
    const price = data?.prices?.[token.symbol] || token.fallbackPrice || 0;
    return Number.isFinite(amount) && Number.isFinite(price) ? sum + amount * price : sum;
  }, 0);

  if (focus === "oracle") {
    return (
      <section id="oracle" className="panel adminPanel">
        <div className="sectionHead">
          <div>
            <h2>Oracle Manager</h2>
            <p>Keeper-managed mock oracle status. Manual override stays disabled unless needed for admin review.</p>
          </div>
          <span className="dangerPill">Admin</span>
        </div>

        <div className="adminSummaryGrid">
          <div>
            <span>Oracle mode</span>
            <strong>Keeper managed</strong>
            <em>Finnhub API via operator keeper</em>
          </div>
          <div>
            <span>Read status</span>
            <strong>{readStatus}</strong>
            <em>{data?.readIssue || "Latest local read state"}</em>
          </div>
          <div>
            <span>Operator</span>
            <strong>{shortAddress(address)}</strong>
            <em>Connected admin wallet</em>
          </div>
        </div>

        <div className="adminTokenGrid">
          {TOKENS.map((token) => {
            const fresh = data?.fresh?.[token.symbol];
            const price = data?.prices?.[token.symbol] || token.fallbackPrice || 0;

            return (
              <article className="adminTokenCard" key={token.symbol}>
                <div>
                  <strong>{token.symbol}</strong>
                  <span>{token.name}</span>
                </div>

                <div className="adminMetricRows">
                  <div>
                    <span>Mock price</span>
                    <strong>{loading ? "Reading..." : formatUsd(price)}</strong>
                  </div>
                  <div>
                    <span>Status</span>
                    <strong>
                      {data?.readIssue
                        ? "RPC retry"
                        : fresh === true
                          ? "Fresh"
                          : fresh === false
                            ? "Stale"
                            : "Checking"}
                    </strong>
                  </div>
                </div>
                <button disabled>
                  {token.symbol === "USDG" ? "Settlement peg" : "Keeper updates active"}
                </button>
              </article>
            );
          })}
        </div>

        <p className="fineprint">
          Oracle values are mock testnet stock references updated periodically by the operator keeper. They are not real-time market data.
        </p>
      </section>
    );
  }

  return (
    <section id="admin" className="panel adminPanel">
      <div className="sectionHead">
        <div>
          <h2>Operator Control Room</h2>
          <p>Keeper monitors pending fees automatically. Manual sweep remains available as operator fallback.</p>
        </div>
        <span className="dangerPill">Admin</span>
      </div>

      <div className="adminSummaryGrid">
        <div>
          <span>Operator</span>
          <strong>{shortAddress(address)}</strong>
          <em>Authorized wallet</em>
        </div>
        <div>
          <span>Vault state</span>
          <strong>{loading ? "Reading..." : vaultState}</strong>
          <em>{data?.paused ? "Emergency pause active" : "Deposits and withdrawals available"}</em>
        </div>
        <div>
          <span>Read status</span>
          <strong>{readStatus}</strong>
          <em>{data?.readIssue || "Contract reads available"}</em>
        </div>
        <div>
          <span>Pending fees</span>
          <strong>{formatUsd(totalPendingUsd)}</strong>
          <em>Estimated by mock oracle prices</em>
        </div>
        <div>
          <span>Total deposits</span>
          <strong>{formatUsd(totalDepositsUsd)}</strong>
          <em>Vault-wide token ledger value</em>
        </div>
      </div>

      <div className="adminTokenGrid">
        {TOKENS.map((token) => {
          const pending = data?.pendingFees?.[token.symbol] || 0n;
          const total = data?.totalDeposits?.[token.symbol] || 0n;
          const buckets = data?.buckets?.[token.symbol] || [0n, 0n, 0n, 0n];

          return (
            <article className="adminTokenCard" key={token.symbol}>
              <div>
                <strong>{token.symbol}</strong>
                <span>{token.name}</span>
              </div>

              <div className="adminMetricRows">
                <div>
                  <span>Pending fees</span>
                  <strong>{loading ? "Reading..." : `${formatAmount(pending, token.decimals, 6)} ${token.symbol}`}</strong>
                </div>
                <div>
                  <span>Total deposits</span>
                  <strong>{loading ? "Reading..." : `${formatAmount(total, token.decimals, 4)} ${token.symbol}`}</strong>
                </div>
              </div>
              
              <div className="adminBucketMini">
                <span>Reserve {formatAmount(buckets[0], token.decimals, 6)}</span>
                <span>Rewards {formatAmount(buckets[1], token.decimals, 6)}</span>
                <span>Router {formatAmount(buckets[2], token.decimals, 6)}</span>
                <span>Ops {formatAmount(buckets[3], token.decimals, 6)}</span>
              </div>

              <button
                type="button"
                disabled={pending <= 0n || Boolean(sweepingSymbol)}
                onClick={() => onSweepFees(token)}
              >
                {sweepingSymbol === token.symbol
                  ? `Sweeping ${token.symbol}...`
                  : pending > 0n
                    ? `Sweep ${token.symbol} fees`
                    : "No fees to sweep"}
              </button>
            </article>
          );
        })}
      </div>

      <div className="adminGrid">
        <div>
          <strong>Treasury Sweep</strong>
          <p>Use the per-token buttons above when pending fees are available.</p>
          <button disabled>Per-token sweep enabled</button>
        </div>
        <div>
          <strong>Vault Safety</strong>
          <p>Emergency controls remain contract-level operator functions and are not exposed through the public interface.</p>
          <button disabled>Contract controlled</button>
        </div>
        <div>
          <strong>Operator Actions</strong>
          <p>Treasury sweeping is the only routine operator action exposed in the public dashboard.</p>
          <button disabled>Configured</button>
        </div>
      </div>
    </section>
  );
}
