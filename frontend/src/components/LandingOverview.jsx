import { LeaderboardPreview } from "./Leaderboard";

export function LandingOverview({ go, data, loading }) {
  return (
    <section className="landingGrid">
      <article className="landingCard primaryLanding">
        <span className="cardKicker">Core action</span>
        <h2>Vault Ledger</h2>
        <p>Deposit supported stock tokens and withdraw the original deposited token from your ledger balance.</p>
        <button className="primaryBtn" onClick={() => go("ledger")}>Open Vault Ledger</button>
      </article>


      <article className="landingCard">
        <span className="cardKicker">Stock DEX</span>
        <h2>Stock Swap</h2>
        <p>Swap testnet stock tokens directly via StockRouter. 1% fee, 10-minute cooldown per wallet.</p>
        <button className="secondaryBtn" onClick={() => go("swap")}>Open Swap</button>
      </article>

      <article className="landingCard">
        <span className="cardKicker">Receipt token</span>
        <h2>Non-transferable rINDEX</h2>
        <p>rINDEX acts as a non-transferable receipt for your vault position. It is not a tradable yield token.</p>
        <button className="secondaryBtn" onClick={() => go("rindex")}>View rINDEX</button>
      </article>

      <article className="landingCard">
        <span className="cardKicker">Protocol treasury</span>
        <h2>Protocol Treasury</h2>
        <p>Fees are split into reserve, rewards, router liquidity, and operator buckets. Rewards are fee-funded only.</p>
        <button className="secondaryBtn" onClick={() => go("treasury")}>View Treasury</button>
      </article>

      <article className="landingCard halfLanding">
        <span className="cardKicker">Fee rewards</span>
        <h2>Claim Rewards</h2>
        <p>Protocol fee rewards distributed weekly. What the vault collects, users share — no inflation, no subsidy.</p>
        <button className="secondaryBtn" onClick={() => go("treasury")}>View Rewards</button>
      </article>

      {/* Memanggil Leaderboard Preview yang sudah dipisah */}
      <LeaderboardPreview go={go} />

      {/* Card Live Oracle Prices */}
      <article className="landingCard wideLanding oraclePriceCard">
        <span className="cardKicker">Live Oracle</span>
        <h2>Token Prices</h2>
        <div className="oraclePriceList">
          {[
            { symbol: "TSLA", name: "Tesla",     fallback: 180 },
            { symbol: "AMZN", name: "Amazon",    fallback: 185 },
            { symbol: "NFLX", name: "Netflix",   fallback: 650 },
            { symbol: "PLTR", name: "Palantir",  fallback: 75 },
            { symbol: "AMD",  name: "AMD",       fallback: 160 },
            { symbol: "USDG", name: "Global Dollar", fallback: 1, forceLive: true },
          ].map((t) => {
            const price = data?.prices?.[t.symbol] || t.fallback;
            const fresh = t.forceLive ? true : data?.fresh?.[t.symbol];
            return (
              <div className="oraclePriceRow" key={t.symbol}>
                <div className="oraclePriceSymbolGroup">
                  <span className="oraclePriceSymbol">{t.symbol}</span>
                  <span className="oraclePriceName">{t.name}</span>
                </div>
                <span className={fresh === false ? "oraclePriceFresh stale" : "oraclePriceFresh"}>
                  {fresh === false ? "stale" : "live"}
                </span>
                <strong className="oraclePriceValue">
                  {loading ? "..." : `$${Number(price).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                </strong>
              </div>
            );
          })}
        </div>
      </article>

      <article className="landingCard wideLanding trustWide">
        <div>
          <span className="cardKicker">Public trust</span>
          <h2>Verified engine, public dApp</h2>
          <p>Robin Index Vault runs on a verified contract stack with a public green terminal interface. The vault records deposited stock tokens in an on-chain ledger, mints non-transferable rINDEX receipts, and routes protocol fees through transparent treasury buckets.</p>
        </div>
        <button className="secondaryBtn" onClick={() => go("contracts")}>View Contracts</button>
        <div className="miniStats" style={{ marginTop: "14px" }}>
          <div><span>Verified</span><strong>5 / 5</strong></div>
          <div><span>Smoke</span><strong>PASS</strong></div>
          <div><span>Invariant</span><strong>PASS</strong></div>
          <div><span>Network</span><strong>46630</strong></div>
        </div>
      </article>

      <article className="landingCard wideLanding assetStrip">
        <div>
          <span className="cardKicker">Supported assets</span>
          <h2>Stock-token vault ledger</h2>
          <p>The vault supports TSLA, AMZN, NFLX, PLTR, and AMD testnet stock tokens, plus USDG as a settlement-style test token. Each deposit stays token-specific in the ledger and can be withdrawn back as the original asset.</p>
        </div>
        <div className="assetChips">
          <span>TSLA</span>
          <span>AMZN</span>
          <span>NFLX</span>
          <span>PLTR</span>
          <span>AMD</span>
        </div>
      </article>
    </section>
  );
}
