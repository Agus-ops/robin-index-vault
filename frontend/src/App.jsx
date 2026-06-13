import { useEffect, useMemo, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { formatUnits, parseUnits } from "viem";
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import {
  CheckCircle2,
  Database,
  ExternalLink,
  Lock,
  Loader2,
  Menu,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import { ADDRESSES, CHAIN_ID, EXPLORER, OPERATORS } from "./contracts/addresses";
import { TOKENS } from "./contracts/tokens";
import { ABIS } from "./contracts/generated";
import {
  ERC20_ABI,
  explorerAddress,
  explorerTx,
  formatAmount,
  formatUsd,
  getFirstBigInt,
  shortAddress,
} from "./lib/contracts";
import "./styles.css";

const USER_VIEWS = [
  ["overview", "Dashboard Overview"],
  ["ledger", "Vault Ledger"],
  ["rindex", "rINDEX Balance"],
  ["treasury", "Treasury & Rewards"],
  ["contracts", "Verified Contracts"],
];

const ADMIN_VIEWS = [
  ["admin", "Admin Control Room"],
  ["oracle", "Oracle Manager"],
];

function emptyData() {
  return {
    walletBalances: {},
    vaultBalances: {},
    receiptByToken: {},
    prices: {},
    fresh: {},
    pendingFees: {},
    totalDeposits: {},
    buckets: {},
    receiptBalance: 0n,
    portfolioUsd: 0,
    paused: false,
  };
}

function toUsdFrom8(value) {
  try {
    return Number(formatUnits(value || 0n, 8));
  } catch {
    return 0;
  }
}

function normalizeAmountInput(value) {
  return String(value || "").trim().replace(",", ".");
}

function formatPreviewNumber(value, maxFractionDigits = 6) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: maxFractionDigits,
    minimumFractionDigits: 0,
  }).format(value);
}

function normalizeBuckets(value) {
  if (!value) return [0n, 0n, 0n, 0n];
  if (Array.isArray(value)) return [value[0] || 0n, value[1] || 0n, value[2] || 0n, value[3] || 0n];
  const vals = Object.values(value).filter((x) => typeof x === "bigint");
  return [vals[0] || 0n, vals[1] || 0n, vals[2] || 0n, vals[3] || 0n];
}

function App() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { switchChain } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [view, setView] = useState("overview");
  const [modal, setModal] = useState(null);
  const [selectedToken, setSelectedToken] = useState(TOKENS[0]);
  const [amount, setAmount] = useState("");
  const [data, setData] = useState(emptyData());
  const [loading, setLoading] = useState(false);
  const [writeBusy, setWriteBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const isRightChain = chainId === CHAIN_ID;

  const isOperator = useMemo(() => {
    return address && OPERATORS.includes(address.toLowerCase());
  }, [address]);

  async function readMaybe(contractAddress, abi, functionName, args = []) {
    try {
      return await publicClient.readContract({
        address: contractAddress,
        abi,
        functionName,
        args,
      });
    } catch {
      return null;
    }
  }

  function showToast(kind, text, hash = null) {
    setToast({ kind, text, hash });
    window.clearTimeout(window.__robinToastTimer);
    window.__robinToastTimer = window.setTimeout(() => setToast(null), 8000);
  }

  async function waitForTx(hash) {
    if (!publicClient || !hash) return;
    await publicClient.waitForTransactionReceipt({ hash });
    setRefreshNonce((x) => x + 1);
  }

  async function runDeposit() {
    if (!address || !publicClient || !selectedToken || !amount) return;

    setWriteBusy(true);

    try {
      const parsedAmount = parseUnits(normalizeAmountInput(amount), selectedToken.decimals);

      if (parsedAmount <= 0n) {
        throw new Error("Amount must be greater than zero.");
      }

      const allowance = await publicClient.readContract({
        address: selectedToken.address,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, ADDRESSES.vault],
      });

      if (allowance < parsedAmount) {
        const approveHash = await writeContractAsync({
          address: selectedToken.address,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [ADDRESSES.vault, parsedAmount],
        });

        showToast("info", `Approve submitted for ${selectedToken.symbol}`, approveHash);
        await waitForTx(approveHash);
      }

      const depositHash = await writeContractAsync({
        address: ADDRESSES.vault,
        abi: ABIS.RobinIndexVault,
        functionName: "deposit",
        args: [selectedToken.address, parsedAmount],
      });

      showToast("success", `Deposit submitted: ${selectedToken.symbol}`, depositHash);
      await waitForTx(depositHash);
      closeModal();
    } catch (err) {
      showToast("error", err?.shortMessage || err?.message || "Deposit failed");
    } finally {
      setWriteBusy(false);
    }
  }

  async function runWithdraw() {
    if (!address || !publicClient || !selectedToken || !amount) return;

    setWriteBusy(true);

    try {
      const parsedAmount = parseUnits(normalizeAmountInput(amount), selectedToken.decimals);

      if (parsedAmount <= 0n) {
        throw new Error("Amount must be greater than zero.");
      }

      const withdrawHash = await writeContractAsync({
        address: ADDRESSES.vault,
        abi: ABIS.RobinIndexVault,
        functionName: "withdraw",
        args: [selectedToken.address, parsedAmount],
      });

      showToast("success", `Withdraw submitted: ${selectedToken.symbol}`, withdrawHash);
      await waitForTx(withdrawHash);
      closeModal();
    } catch (err) {
      showToast("error", err?.shortMessage || err?.message || "Withdraw failed");
    } finally {
      setWriteBusy(false);
    }
  }


  async function loadVaultData() {
    if (!publicClient) return;

    setLoading(true);

    const next = emptyData();

    try {
      next.paused = Boolean(
        await readMaybe(ADDRESSES.vault, ABIS.RobinIndexVault, "paused", [])
      );

      if (address) {
        const rBal = await readMaybe(ADDRESSES.receipt, ERC20_ABI, "balanceOf", [address]);
        next.receiptBalance = rBal || 0n;

        const pValue = await readMaybe(
          ADDRESSES.vault,
          ABIS.RobinIndexVault,
          "getUserPortfolioValueUsd",
          [address]
        );
        next.portfolioUsd = toUsdFrom8(pValue || 0n);
      }

      for (const token of TOKENS) {
        const sym = token.symbol;

        const priceRaw = await readMaybe(
          ADDRESSES.oracle,
          ABIS.MockStockOracle,
          "getPrice",
          [token.address]
        );
        const priceBig = getFirstBigInt(priceRaw);
        next.prices[sym] = priceBig > 0n ? toUsdFrom8(priceBig) : token.fallbackPrice;

        const freshRaw = await readMaybe(
          ADDRESSES.oracle,
          ABIS.MockStockOracle,
          "isFresh",
          [token.address]
        );
        next.fresh[sym] = freshRaw === null ? null : Boolean(freshRaw);

        const pending = await readMaybe(
          ADDRESSES.vault,
          ABIS.RobinIndexVault,
          "pendingFees",
          [token.address]
        );
        next.pendingFees[sym] = pending || 0n;

        const total = await readMaybe(
          ADDRESSES.vault,
          ABIS.RobinIndexVault,
          "totalTokenDeposits",
          [token.address]
        );
        next.totalDeposits[sym] = total || 0n;

        const buckets = await readMaybe(
          ADDRESSES.treasury,
          ABIS.FeeTreasury,
          "getBuckets",
          [token.address]
        );
        next.buckets[sym] = normalizeBuckets(buckets);

        if (address) {
          const walletBal = await readMaybe(token.address, ERC20_ABI, "balanceOf", [address]);
          next.walletBalances[sym] = walletBal || 0n;

          const vaultBal = await readMaybe(
            ADDRESSES.vault,
            ABIS.RobinIndexVault,
            "userBalances",
            [address, token.address]
          );
          next.vaultBalances[sym] = vaultBal || 0n;

          const receiptByToken = await readMaybe(
            ADDRESSES.vault,
            ABIS.RobinIndexVault,
            "getUserReceiptByToken",
            [address, token.address]
          );
          next.receiptByToken[sym] = receiptByToken || 0n;
        }
      }

      if (address && next.portfolioUsd === 0) {
        let fallbackPortfolioUsd = 0;

        for (const token of TOKENS) {
          const rawBalance = next.vaultBalances[token.symbol] || 0n;
          const tokenAmount = Number(formatUnits(rawBalance, token.decimals));
          const tokenPrice = next.prices[token.symbol] || token.fallbackPrice || 0;

          if (Number.isFinite(tokenAmount) && Number.isFinite(tokenPrice)) {
            fallbackPortfolioUsd += tokenAmount * tokenPrice;
          }
        }

        next.portfolioUsd = fallbackPortfolioUsd;
      }

      setData(next);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadVaultData();
  }, [address, publicClient, refreshNonce]);

  function go(nextView) {
    setView(nextView);
    setDrawerOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openModal(type, token) {
    setSelectedToken(token);
    setModal(type);
    setAmount("");
  }

  function closeModal() {
    setModal(null);
    setAmount("");
  }

  function refresh() {
    setRefreshNonce((x) => x + 1);
  }

  const estimateUsd = Number(normalizeAmountInput(amount) || 0) * (data.prices[selectedToken.symbol] || selectedToken.fallbackPrice);

  return (
    <div className="app">
      <div className="glow glowA" />
      <div className="glow glowB" />

      <header className="topbar">
        <div className="brand brandBlank" aria-hidden="true"></div>

        <div className="topActions">
          <div className={isConnected && isRightChain ? "chainOk" : "chainBad"}>
            <span />
            {isRightChain ? "Robinhood Testnet" : "Wrong Network"}
          </div>

          <ConnectButton />

          <button className="iconBtn" onClick={() => setDrawerOpen(true)} aria-label="Open menu">
            <Menu size={22} />
          </button>
        </div>
      </header>

      {drawerOpen && (
        <>
          <button className="overlay" onClick={() => setDrawerOpen(false)} aria-label="Close overlay" />
          <aside className="drawer">
            <div className="drawerHead">
              <div>
                <strong>Vault Terminal</strong>
                <span>{isConnected ? shortAddress(address) : "Wallet not connected"}</span>
              </div>
              <button className="iconBtn" onClick={() => setDrawerOpen(false)} aria-label="Close menu">
                <X size={20} />
              </button>
            </div>

            <nav className="drawerNav">
              {USER_VIEWS.map(([key, label]) => (
                <button key={key} className={view === key ? "active" : ""} onClick={() => go(key)}>
                  {label}
                </button>
              ))}

              {isOperator && (
                <>
                  <div className="drawerSep" />
                  {ADMIN_VIEWS.map(([key, label]) => (
                    <button key={key} className={view === key ? "active" : ""} onClick={() => go(key)}>
                      {label}
                    </button>
                  ))}
                </>
              )}

              <div className="drawerSep" />

              <a href="https://github.com/Agus-ops/robin-index-vault" target="_blank" rel="noreferrer">
                GitHub <ExternalLink size={14} />
              </a>
              <a href="https://github.com/Agus-ops/robin-index-vault/releases/tag/v0.3.0" target="_blank" rel="noreferrer">
                Release v0.3.0 <ExternalLink size={14} />
              </a>
            </nav>
          </aside>
        </>
      )}

      <main>
        {view === "overview" && (
          <>
            <Hero
              isRightChain={isRightChain}
              isConnected={isConnected}
              switchChain={switchChain}
              paused={data.paused}
              loading={loading}
            />
            <LandingOverview go={go} />
          </>
        )}

        {view === "ledger" && (
          <>
            <ViewHero
              title="Vault Ledger"
              subtitle="Deposit and withdraw supported testnet stock tokens from your ledger-based vault position."
            />
            <SummaryLedger
              data={data}
              loading={loading}
              refresh={refresh}
              openModal={openModal}
              isConnected={isConnected}
              isRightChain={isRightChain}
            />
          </>
        )}

        {view === "rindex" && (
          <>
            <ViewHero
              title="rINDEX Balance"
              subtitle="Your non-transferable receipt token for ledger-based vault deposits."
            />
            <div className="singlePanel">
              <PortfolioPanel data={data} isConnected={isConnected} loading={loading} />
            </div>
          </>
        )}

        {view === "treasury" && (
          <>
            <ViewHero
              title="Treasury & Rewards"
              subtitle="Protocol fees are split into transparent buckets. Rewards are fee-funded only."
            />
            <div className="singlePanel">
              <TreasuryPanel data={data} />
            </div>
          </>
        )}

        {view === "contracts" && (
          <>
            <ViewHero
              title="Verified Contracts"
              subtitle="All active vault contracts are verified on Robinhood Chain Testnet explorer."
            />
            <div className="singlePanel">
              <ContractsPanel />
            </div>
          </>
        )}

        {view === "admin" && (
          <>
            <ViewHero title="Operator Control Room" subtitle="Operator tools remain gated and hidden from normal users." />
            <AdminPanel isOperator={isOperator} focus="admin" />
          </>
        )}

        {view === "oracle" && (
          <>
            <ViewHero title="Oracle Manager" subtitle="Admin-only mock oracle controls for the testnet deployment." />
            <AdminPanel isOperator={isOperator} focus="oracle" />
          </>
        )}
      </main>

      {modal && (
        <ActionModal
          modal={modal}
          selectedToken={selectedToken}
          amount={amount}
          setAmount={setAmount}
          estimateUsd={estimateUsd}
          closeModal={closeModal}
          onConfirm={modal === "deposit" ? runDeposit : runWithdraw}
          writeBusy={writeBusy}
          isConnected={isConnected}
          isRightChain={isRightChain}
        />
      )}

      {toast && (
        <div className={`toast ${toast.kind}`}>
          <strong>{toast.kind === "error" ? "Transaction Error" : "Transaction Status"}</strong>
          <span>{toast.text}</span>
          {toast.hash && (
            <a href={explorerTx(EXPLORER, toast.hash)} target="_blank" rel="noreferrer">
              View transaction <ExternalLink size={13} />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function Hero({ isRightChain, isConnected, switchChain, paused, loading }) {
  return (
    <section className="hero">
      <div>
        <div className="eyebrow">Robinhood Chain Testnet · Chain ID 46630</div>
        <h1>Robin Index Vault</h1>
        <p>A premium green terminal for ledger-based testnet stock tokens. Deposit supported assets, receive non-transferable rINDEX receipts, and withdraw the original token from your on-chain vault ledger.</p>

        <div className="badges">
          <span><ShieldCheck size={15} /> Verified deployment</span>
          <span><CheckCircle2 size={15} /> Smoke tested</span>
          <span><Database size={15} /> Invariant 65 / 0 / 0</span>
        </div>
      </div>

      <div className="heroCard">
        <span>Network status</span>
        <strong>{isRightChain ? "Network Ready" : "Wrong Network"}</strong>
        <p>
        {loading
          ? "Reading on-chain vault state..."
          : isRightChain
            ? isConnected
              ? "Connected to Robinhood Chain Testnet."
              : "Wallet not connected. Connect wallet to load your vault state."
            : "Switch wallet network to Robinhood Chain Testnet."}
      </p>

        {!isRightChain && isConnected && (
          <button className="primaryBtn" onClick={() => switchChain?.({ chainId: CHAIN_ID })}>
            Switch Network
          </button>
        )}
      </div>
    </section>
  );
}

function ViewHero({ title, subtitle }) {
  return (
    <section className="viewHero">
      <div className="eyebrow">Robin Index Vault Terminal</div>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </section>
  );
}

function LandingOverview({ go }) {
  return (
    <section className="landingGrid">
      <article className="landingCard primaryLanding">
        <span className="cardKicker">Core action</span>
        <h2>Vault Ledger</h2>
        <p>Deposit supported testnet stock tokens and withdraw the original deposited token from your ledger balance.</p>
        <button className="primaryBtn" onClick={() => go("ledger")}>Open Vault Ledger</button>
      </article>

      <article className="landingCard">
        <span className="cardKicker">Receipt token</span>
        <h2>Non-transferable rINDEX</h2>
        <p>rINDEX acts as a non-transferable receipt for your vault position. It is not a tradable yield token.</p>
        <button className="secondaryBtn" onClick={() => go("rindex")}>View rINDEX</button>
      </article>

      <article className="landingCard">
        <span className="cardKicker">Protocol fees</span>
        <h2>Treasury buckets</h2>
        <p>Fees are split into reserve, rewards, router liquidity, and operator buckets. Rewards are fee-funded only.</p>
        <button className="secondaryBtn" onClick={() => go("treasury")}>View Treasury</button>
      </article>

      <article className="landingCard wideLanding trustWide">
        <div>
          <span className="cardKicker">Public trust</span>
          <h2>Verified engine, public dApp</h2>
          <p>Robin Index Vault runs on a verified contract stack with a public green terminal interface. The vault records deposited stock tokens in an on-chain ledger, mints non-transferable rINDEX receipts, and routes protocol fees through transparent treasury buckets.</p>
        </div>
        <button className="secondaryBtn" onClick={() => go("contracts")}>View Contracts</button>
      </article>

      <article className="landingCard wideLanding">
        <div className="miniStats">
          <div><span>Verified</span><strong>5 / 5</strong></div>
          <div><span>Smoke</span><strong>PASS</strong></div>
          <div><span>Invariant</span><strong>65 / 0 / 0</strong></div>
          <div><span>Network</span><strong>46630</strong></div>
        </div>
      </article>

      <article className="landingCard wideLanding assetStrip">
        <div>
          <span className="cardKicker">Supported assets</span>
          <h2>Stock-token vault ledger</h2>
          <p>The vault currently supports TSLA, AMZN, NFLX, PLTR, and AMD testnet stock tokens. Each deposit stays token-specific in the ledger and can be withdrawn back as the original asset.</p>
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

function SummaryLedger({ data, loading, refresh, openModal, isConnected, isRightChain }) {
  return (
    <section id="ledger" className="panel">
      <div className="sectionHead">
        <div>
          <h2>Vault Ledger</h2>
          <p>Ledger-based positions per deposited asset.</p>
        </div>
        <button className="secondaryBtn" onClick={refresh}>
          {loading ? <Loader2 className="spin" size={15} /> : "Refresh"}
        </button>
      </div>

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

      <div className="assetList">
        {TOKENS.map((token) => {
          const fresh = data.fresh[token.symbol];
          const depositDisabled = !isConnected || !isRightChain || data.paused || fresh === false;
          const withdrawDisabled = !isConnected || !isRightChain;

          return (
            <article className="assetCard" key={token.symbol}>
              <div className="assetMain">
                <div className="tokenMark">{token.symbol.slice(0, 1)}</div>
                <div>
                  <strong>{token.symbol}</strong>
                  <span>{token.name}</span>
                  <em className={fresh === false ? "miniBadge stale" : "miniBadge fresh"}>
                    {fresh === false ? "Oracle stale" : fresh === true ? "Oracle fresh" : "Oracle check"}
                  </em>
                </div>
              </div>

              <div className="assetData">
                <div>
                  <span>Oracle price</span>
                  <strong>{formatUsd(data.prices[token.symbol] || token.fallbackPrice)}</strong>
                </div>
                <div>
                  <span>Wallet</span>
                  <strong>
                    {isConnected
                      ? `${formatAmount(data.walletBalances[token.symbol] || 0n, token.decimals)} ${token.symbol}`
                      : "—"}
                  </strong>
                </div>
                <div>
                  <span>Vault ledger</span>
                  <strong>
                    {isConnected
                      ? `${formatAmount(data.vaultBalances[token.symbol] || 0n, token.decimals)} ${token.symbol}`
                      : "—"}
                  </strong>
                </div>
              </div>

              <div className="assetActions">
                <button disabled={depositDisabled} onClick={() => openModal("deposit", token)}>
                  {data.paused ? "Paused" : fresh === false ? "Stale" : "Deposit"}
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

function PortfolioPanel({ data, isConnected, loading }) {
  let displayPortfolioUsd = data.portfolioUsd || 0;

  if (isConnected && displayPortfolioUsd === 0) {
    for (const token of TOKENS) {
      const rawBalance = data.vaultBalances[token.symbol] || 0n;
      const tokenAmount = Number(formatUnits(rawBalance, token.decimals));
      const tokenPrice = data.prices[token.symbol] || token.fallbackPrice || 0;

      if (Number.isFinite(tokenAmount) && Number.isFinite(tokenPrice)) {
        displayPortfolioUsd += tokenAmount * tokenPrice;
      }
    }
  }

  const receiptText = isConnected ? `${formatAmount(data.receiptBalance, 18)} rINDEX` : "Connect wallet";
  const receiptStatus = !isConnected ? "Wallet required" : data.receiptBalance > 0n ? "Active receipt" : "No receipt yet";

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

function TreasuryPanel({ data }) {
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
        {TOKENS.map((token) => {
          const buckets = data.buckets[token.symbol] || [0n, 0n, 0n, 0n];

          return (
            <article className="treasuryTokenCard" key={token.symbol}>
              <div className="treasuryTokenTop">
                <strong>{token.symbol}</strong>
                <span>{token.name}</span>
              </div>

              <div className="treasuryMetricRows">
                <div>
                  <span>Pending fees</span>
                  <strong>{formatAmount(data.pendingFees[token.symbol] || 0n, token.decimals, 6)} {token.symbol}</strong>
                </div>
                <div>
                  <span>Total deposits</span>
                  <strong>{formatAmount(data.totalDeposits[token.symbol] || 0n, token.decimals, 4)} {token.symbol}</strong>
                </div>
              </div>

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

      <p className="fineprint">
        Rewards are distributed only from collected protocol fees. This page does not imply APY,
        APR, guaranteed yield, or real stock ownership.
      </p>
    </section>
  );
}

function ContractsPanel() {
  return (
    <section id="contracts" className="panel contractsPanel">
      <div className="sectionHead">
        <div>
          <h2>Verified Contracts</h2>
          <p>Active contract stack verified on explorer.</p>
        </div>
        <ShieldCheck size={20} />
      </div>

      <ContractLink name="MockStockOracle" address={ADDRESSES.oracle} />
      <ContractLink name="ReceiptToken / rINDEX" address={ADDRESSES.receipt} />
      <ContractLink name="FeeTreasury" address={ADDRESSES.treasury} />
      <ContractLink name="RobinIndexVault" address={ADDRESSES.vault} />
      <ContractLink name="RewardDistributor" address={ADDRESSES.rewardDistributor} />

      <div className="trustGrid">
        <span>Smoke: PASS</span>
        <span>Invariant: 65</span>
        <span>Warnings: 0</span>
        <span>Failures: 0</span>
      </div>
    </section>
  );
}

function AdminPanel({ isOperator, focus }) {
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

  return (
    <section id="admin" className="panel adminPanel">
      <div className="sectionHead">
        <div>
          <h2>{focus === "oracle" ? "Oracle Manager" : "Operator Control Room"}</h2>
          <p>Operator-only panel. Write controls are planned for the next wiring pass.</p>
        </div>
        <span className="dangerPill">Admin</span>
      </div>

      <div className="adminGrid">
        <div>
          <strong>Oracle Manager</strong>
          <p>Oracle price controls for supported vault assets.</p>
          <button disabled>Coming soon</button>
        </div>
        <div>
          <strong>Treasury Sweep</strong>
          <p>Move pending protocol fees into transparent treasury buckets.</p>
          <button disabled>Coming soon</button>
        </div>
        <div>
          <strong>Emergency</strong>
          <p>Emergency controls for testnet safety operations.</p>
          <button disabled>Coming soon</button>
        </div>
      </div>
    </section>
  );
}

function ActionModal({
  modal,
  selectedToken,
  amount,
  setAmount,
  estimateUsd,
  closeModal,
  onConfirm,
  writeBusy,
  isConnected,
  isRightChain,
}) {
  const normalizedAmount = normalizeAmountInput(amount);
  const inputAmount = Number(normalizedAmount);
  const safeAmount = Number.isFinite(inputAmount) && inputAmount > 0 ? inputAmount : 0;

  // UI estimate only. Contract remains source of truth.
  // Deposit fee: 50 bps / 0.5%
  // Withdraw normal fee: 20 bps / 0.2%
  // Early withdraw may be higher in contract preview.
  const depositFeeRate = 0.005;
  const withdrawFeeRate = 0.002;
  const activeFeeRate = modal === "deposit" ? depositFeeRate : withdrawFeeRate;

  const protocolFeeAmount = safeAmount * activeFeeRate;
  const netReceiptUsd = estimateUsd * (1 - depositFeeRate);
  const netReceiveAmount = Math.max(safeAmount - protocolFeeAmount, 0);

  const protocolFeeText =
    safeAmount <= 0
      ? "—"
      : `≈ ${formatPreviewNumber(protocolFeeAmount)} ${selectedToken.symbol}`;

  const expectedText =
    safeAmount <= 0
      ? "—"
      : modal === "deposit"
        ? `≈ ${formatPreviewNumber(netReceiptUsd, 4)} rINDEX`
        : `≈ ${formatPreviewNumber(netReceiveAmount)} ${selectedToken.symbol}`;

  return (
    <div className="modalWrap">
      <div className="modal">
        <div className="modalHead">
          <div>
            <h3>{modal === "deposit" ? "Deposit" : "Withdraw"} {selectedToken.symbol}</h3>
            <p>{modal === "deposit" ? "Deposit stock tokens into the vault ledger." : "Withdraw the original token from your vault ledger."}</p>
          </div>
          <button className="iconBtn" onClick={closeModal}><X size={18} /></button>
        </div>

        <label className="amountLabel">
          Amount
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" inputMode="decimal" />
        </label>

        <div className="breakdown">
          <div><span>Selected asset</span><strong>{selectedToken.symbol}</strong></div>
          <div><span>Estimated USD value</span><strong>{formatUsd(estimateUsd)}</strong></div>
          <div><span>{modal === "deposit" ? "Protocol fee" : "Withdrawal fee"}</span><strong>{protocolFeeText}</strong></div>
          <div><span>{modal === "deposit" ? "Expected receipt" : "Expected receive"}</span><strong>{expectedText}</strong></div>
        </div>

        <button
          className="primaryBtn wide"
          disabled={writeBusy || !isConnected || !isRightChain || !amount}
          onClick={onConfirm}
        >
          {writeBusy
            ? "Confirming..."
            : modal === "deposit"
              ? "Approve + Deposit"
              : "Confirm Withdraw"}
        </button>

        <p className="fineprint">
          Estimates are UI previews. Final fee and receipt/burn are enforced by the verified contract. No APY, no guaranteed yield.
        </p>
      </div>
    </div>
  );
}

function Bucket({ label, pct }) {
  return (
    <div className="bucket">
      <div>
        <span>{label}</span>
        <strong>{pct}%</strong>
      </div>
      <div className="bar">
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ContractLink({ name, address }) {
  return (
    <a className="contractLink" href={explorerAddress(EXPLORER, address)} target="_blank" rel="noreferrer">
      <span>{name}</span>
      <strong>{shortAddress(address)}</strong>
      <ExternalLink size={14} />
    </a>
  );
}

export default App;
