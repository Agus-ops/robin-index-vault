import { formatUnits } from "viem";
import { TOKENS } from "../contracts/tokens";

// Ikon diasumsikan dari lucide-react sesuai dengan template UI
import { Wallet, Lock } from "lucide-react";

export function PortfolioPanel({ data, isConnected, loading }) {
  let displayPortfolioUsd = data?.portfolioUsd || 0;

  // Formatting helper internal
  function formatUsd(val) {
    if (!val) return "$0.00";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);
  }

  function formatAmount(amount, decimals) {
    if (!amount) return "0.00";
    const base = 10n ** BigInt(decimals);
    const integerPart = amount / base;
    const fractionalPart = amount % base;
    let fractionStr = fractionalPart.toString().padStart(decimals, "0");
    fractionStr = fractionStr.slice(0, 4); // Ambil 4 desimal
    return `${integerPart}.${fractionStr}`;
  }

  if (isConnected && displayPortfolioUsd === 0) {
    for (const token of TOKENS) {
      const rawBalance = data?.vaultBalances?.[token.symbol] || 0n;
      const tokenAmount = Number(formatUnits(rawBalance, token.decimals));
      const tokenPrice = data?.prices?.[token.symbol] || token.fallbackPrice || 0;

      if (Number.isFinite(tokenAmount) && Number.isFinite(tokenPrice)) {
        displayPortfolioUsd += tokenAmount * tokenPrice;
      }
    }
  }

  const receiptText = isConnected ? `${formatAmount(data?.receiptBalance, 18)} rINDEX` : "Connect wallet";
  const receiptStatus = !isConnected ? "Wallet required" : data?.receiptBalance > 0n ? "Active receipt" : "No receipt yet";

  return (
    <section id="rindex" className="panel metricPanel rindexPanel">
      <div className="sectionHead">
        <div>
          <h2>Your Vault Portfolio</h2>
          <p>Ledger-backed position value and non-transferable rINDEX receipt.</p>
        </div>
        <Wallet size={20} />
      </div>

      <div className="rindexHeroMetric">
        <span>Estimated vault value</span>
        <div className="bigNumber">
          {loading ? "Reading..." : isConnected ? formatUsd(displayPortfolioUsd) : "—"}
        </div>
        <p>Calculated from your vault ledger balances and mock oracle prices.</p>
      </div>

      <div className="rindexBox rindexReceiptBox">
        <span>rINDEX Balance</span>
        <strong>{receiptText}</strong>
        <em><Lock size={13} /> Account-bound receipt token</em>
      </div>

      <div className="receiptInfoGrid">
        <div>
          <span>Receipt status</span>
          <strong>{receiptStatus}</strong>
        </div>
        <div>
          <span>Transferability</span>
          <strong>Locked</strong>
        </div>
        <div>
          <span>Reward model</span>
          <strong>Fee-funded</strong>
        </div>
      </div>

      <p className="fineprint">
        rINDEX represents your vault receipt balance only. It is not a tradable stock token,
        not a yield token, and does not guarantee APY. Withdraw returns the original deposited
        token from your ledger balance.
      </p>
    </section>
  );
}
