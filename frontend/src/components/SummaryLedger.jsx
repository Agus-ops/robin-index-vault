import { DailyCheckIn } from "./DailyCheckIn";
import { TOKENS } from "../contracts/tokens";

// Kita asumsikan Loader2 di-import dari lucide-react jika menggunakan template standar Vite dApps
import { Loader2 } from "lucide-react";

export function SummaryLedger({ 
  data, 
  loading, 
  refresh, 
  openModal, 
  isConnected, 
  isRightChain 
}) {
  const hasReadIssue = Boolean(data?.readIssue);

  // Helper formatting internal agar tidak bergantung penuh pada utilitas luar
  function formatUsd(val) {
    if (!val) return "$0.00";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(val));
  }

  function formatAmount(amount, decimals) {
    if (!amount) return "0.00";
    const base = 10n ** BigInt(decimals);
    const integerPart = amount / base;
    const fractionalPart = amount % base;
    let fractionStr = fractionalPart.toString().padStart(decimals, "0");
    fractionStr = fractionStr.slice(0, 4); // Ambil 4 angka di belakang koma
    return `${integerPart}.${fractionStr}`;
  }

  return (
    <section id="ledger" className="panel">
      <div className="sectionHead">
        <div>
          <h2>Vault Ledger</h2>
          <p>Ledger-based positions per deposited asset.</p>
        </div>
        <button className="secondaryBtn" onClick={refresh}>
          {loading ? (
            <>
              <Loader2 className="spin" size={15} /> Reading...
            </>
          ) : (
            "Refresh"
          )}
        </button>
      </div>

      {/* Memanggil komponen DailyCheckIn yang sudah dipisah */}
      <DailyCheckIn isConnected={isConnected} isRightChain={isRightChain} />

      {(!isConnected || !isRightChain) && (
        <div className="ledgerNotice">
          <strong>{!isConnected ? "Wallet required" : "Wrong network"}</strong>
          <span>
            {!isConnected
              ? "Connect a wallet to load balances and enable vault actions."
              : "Switch to Robinhood Chain Testnet to use vault actions."}
          </span>
        </div>
      )}

      {hasReadIssue && (
        <div className="ledgerNotice readIssue">
          <strong>RPC retry</strong>
          <span>{data.readIssue}</span>
        </div>
      )}

      <div className="assetList">
        {(TOKENS || []).map((token) => {
          const fresh = data?.fresh?.[token.symbol];
          const depositDisabled = !isConnected || !isRightChain || data?.paused || fresh === false;
          const withdrawDisabled = !isConnected || !isRightChain;

          return (
            <article className="assetCard" key={token.symbol}>
              <div className="assetMain">
                <div className="tokenMark">{token.symbol.slice(0, 1)}</div>
                <div>
                  <strong>{token.symbol}</strong>
                  <span>{token.name}</span>
                  <em className={fresh === false ? "miniBadge stale" : "miniBadge fresh"}>
                    {hasReadIssue ? "RPC retry" : fresh === false ? "Oracle stale" : fresh === true ? "Oracle fresh" : "Oracle check"}
                  </em>
                </div>
              </div>

              <div className="assetData">
                <div>
                  <span>Oracle price</span>
                  <strong>
                    {loading ? "Reading..." : hasReadIssue ? "RPC retry" : formatUsd(data?.prices?.[token.symbol] || token.fallbackPrice)}
                  </strong>
                </div>
                <div>
                  <span>Wallet</span>
                  <strong>
                    {loading
                      ? "Reading..."
                      : hasReadIssue
                        ? "RPC retry"
                        : isConnected
                          ? `${formatAmount(data?.walletBalances?.[token.symbol] || 0n, token.decimals)} ${token.symbol}`
                          : "—"}
                  </strong>
                </div>
                <div>
                  <span>Vault ledger</span>
                  <strong>
                    {loading
                      ? "Reading..."
                      : hasReadIssue
                        ? "RPC retry"
                        : isConnected
                          ? `${formatAmount(data?.vaultBalances?.[token.symbol] || 0n, token.decimals)} ${token.symbol}`
                          : "—"}
                  </strong>
                </div>
              </div>

              <div className="assetActions">
                <button disabled={depositDisabled} onClick={() => openModal("deposit", token)}>
                  {data?.paused ? "Paused" : fresh === false ? "Stale" : "Deposit"}
                </button>
                <button disabled={withdrawDisabled} onClick={() => openModal("withdraw", token)}>
                  Withdraw
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
