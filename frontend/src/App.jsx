import { useEffect, useMemo, useState, useRef} from "react";
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
import RewardPanel from "./components/RewardPanel";

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
    readIssue: null,
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

const VAULT_SWEEP_ABI = [
  {
    type: "function",
    name: "sweepFees",
    stateMutability: "nonpayable",
    inputs: [{ name: "token", type: "address" }],
    outputs: [],
  },
];

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
  const [debouncedAmount, setDebouncedAmount] = useState("");
  const [data, setData] = useState(emptyData());
  const [loading, setLoading] = useState(false);
  const [writeBusy, setWriteBusy] = useState(false);
  const [sweepingSymbol, setSweepingSymbol] = useState(null);
  const [toast, setToast] = useState(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewCallId = useRef(0);

  const isRightChain = chainId === CHAIN_ID;

  const isOperator = useMemo(() => {
    return address && OPERATORS.includes(address.toLowerCase());
  }, [address]);

  useEffect(() => {
    previewCallId.current += 1;
    setPreview(null);
    setPreviewLoading(false);
  }, [modal, selectedToken?.address, amount]);

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

    showToast("success", "Transaction confirmed. Refreshing balances...", hash);

    // Refresh immediately, then retry after short delays because RPC/indexed reads
    // can lag a few seconds after a confirmed transaction.
    setRefreshNonce((x) => x + 1);
    window.setTimeout(() => setRefreshNonce((x) => x + 1), 1500);
    window.setTimeout(() => setRefreshNonce((x) => x + 1), 4000);
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


  async function runSweepFees(token) {
    if (!token || !isOperator || !isConnected || !isRightChain || sweepingSymbol) return;

    const pending = data.pendingFees?.[token.symbol] || 0n;

    if (pending <= 0n) {
      showToast("info", `No pending fees for ${token.symbol}`);
      return;
    }

    const ok = window.confirm(`Sweep pending ${token.symbol} protocol fees into treasury buckets?`);

    if (!ok) return;

    setSweepingSymbol(token.symbol);

    try {
      const hash = await writeContractAsync({
        address: ADDRESSES.vault,
        abi: VAULT_SWEEP_ABI,
        functionName: "sweepFees",
        args: [token.address],
      });

      showToast("info", `Sweep submitted: ${token.symbol}`, hash);
      await waitForTx(hash);
    } catch (err) {
      showToast("error", err?.shortMessage || err?.message || `Sweep failed: ${token.symbol}`);
    } finally {
      setSweepingSymbol(null);
    }
  }

  async function loadVaultData() {
    if (!publicClient) return;

    setLoading(true);

    const next = emptyData();

    try {
      const [pausedRaw, receiptBalanceRaw, portfolioRaw] = await Promise.all([
        readMaybe(ADDRESSES.vault, ABIS.RobinIndexVault, "paused", []),
        address ? readMaybe(ADDRESSES.receipt, ERC20_ABI, "balanceOf", [address]) : Promise.resolve(null),
        address
          ? readMaybe(ADDRESSES.vault, ABIS.RobinIndexVault, "getUserPortfolioValueUsd", [address])
          : Promise.resolve(null),
      ]);

      next.paused = Boolean(pausedRaw);
      next.receiptBalance = receiptBalanceRaw || 0n;

      const portfolioBig = getFirstBigInt(portfolioRaw);
      next.portfolioUsd = portfolioBig > 0n ? toUsdFrom8(portfolioBig) : 0;

      const tokenResults = await Promise.all(
        TOKENS.map(async (token) => {
          const sym = token.symbol;

          const reads = [
            readMaybe(ADDRESSES.oracle, ABIS.MockStockOracle, "getPrice", [token.address]),
            readMaybe(ADDRESSES.oracle, ABIS.MockStockOracle, "isFresh", [token.address]),
            readMaybe(ADDRESSES.vault, ABIS.RobinIndexVault, "pendingFees", [token.address]),
            readMaybe(ADDRESSES.vault, ABIS.RobinIndexVault, "totalTokenDeposits", [token.address]),
            readMaybe(ADDRESSES.treasury, ABIS.FeeTreasury, "getBuckets", [token.address]),
          ];

          if (address) {
            reads.push(
              readMaybe(token.address, ERC20_ABI, "balanceOf", [address]),
              readMaybe(ADDRESSES.vault, ABIS.RobinIndexVault, "userBalances", [address, token.address]),
              readMaybe(ADDRESSES.vault, ABIS.RobinIndexVault, "getUserReceiptByToken", [address, token.address])
            );
          }

          const [
            priceRaw,
            freshRaw,
            pending,
            total,
            buckets,
            walletBal,
            vaultBal,
            receiptByToken,
          ] = await Promise.all(reads);

          return {
            token,
            sym,
            priceRaw,
            freshRaw,
            pending,
            total,
            buckets,
            walletBal,
            vaultBal,
            receiptByToken,
          };
        })
      );

      for (const item of tokenResults) {
        const { token, sym } = item;

        const priceBig = getFirstBigInt(item.priceRaw);
        next.prices[sym] = priceBig > 0n ? toUsdFrom8(priceBig) : token.fallbackPrice;

        next.fresh[sym] = item.freshRaw === null ? null : Boolean(item.freshRaw);
        next.pendingFees[sym] = item.pending || 0n;
        next.totalDeposits[sym] = item.total || 0n;
        next.buckets[sym] = normalizeBuckets(item.buckets);

        if (address) {
          next.walletBalances[sym] = item.walletBal || 0n;
          next.vaultBalances[sym] = item.vaultBal || 0n;
          next.receiptByToken[sym] = item.receiptByToken || 0n;
        }
      }

      if (address) {
        let ledgerPortfolioUsd = 0;

        for (const token of TOKENS) {
          const rawBalance = next.vaultBalances[token.symbol] || 0n;
          const tokenAmount = Number(formatUnits(rawBalance, token.decimals));
          const tokenPrice = next.prices[token.symbol] || token.fallbackPrice || 0;

          if (Number.isFinite(tokenAmount) && Number.isFinite(tokenPrice)) {
            ledgerPortfolioUsd += tokenAmount * tokenPrice;
          }
        }

        // Display the value calculated from vault ledger balances and oracle prices.
        // This avoids wrong UI scaling if the contract portfolio helper returns a different decimal format.
        if (ledgerPortfolioUsd > 0 || next.portfolioUsd === 0) {
          next.portfolioUsd = ledgerPortfolioUsd;
        }
      }

      const oracleChecks = TOKENS.map((token) => next.fresh[token.symbol]);
      const failedOracleChecks = oracleChecks.filter((value) => value === null).length;

      if (failedOracleChecks === TOKENS.length) {
        next.readIssue = "RPC reads failed. Check wallet browser/RPC access and retry.";
      } else if (failedOracleChecks > 0) {
        next.readIssue = "Some contract reads failed. Refresh or retry shortly.";
      }

      setData(next);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadVaultData();
  }, [address, publicClient, refreshNonce]);

  useEffect(() => {
    if (!publicClient) return;

    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (modal || sweepingSymbol) return;

      loadVaultData();
    }, 60000);

    return () => window.clearInterval(id);
  }, [address, publicClient, modal, sweepingSymbol]);

  function refreshVaultData() {
    showToast("info", "Refreshing vault state from contract...");
    setRefreshNonce((x) => x + 1);
  }

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

  async function refreshPreview() {
    // Disabled for mobile-browser stability.
    // Contract preview reads can freeze the modal in some browsers.
    // UI uses estimates; final fee/mint/burn values are enforced by the verified contract.
    return;
  }

  function closeModal() {
    previewCallId.current += 1;
    if (document.activeElement && typeof document.activeElement.blur === "function") {
      document.activeElement.blur();
    }

    setModal(null);
    setAmount("");
    setDebouncedAmount("");
    setPreview(null);
    setPreviewLoading(false);
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
              <TreasuryPanel
                data={data}
                isOperator={isOperator}
                isConnected={isConnected}
                isRightChain={isRightChain}
                onSweepFees={runSweepFees}
                sweepingSymbol={sweepingSymbol}
              />
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
            <ViewHero title="Operator Control Room" subtitle="Keeper-assisted operator dashboard for vault, fee, and treasury state." />
            <AdminPanel data={data} loading={loading} address={address} isOperator={isOperator} focus="admin" onSweepFees={runSweepFees} sweepingSymbol={sweepingSymbol} />
          </>
        )}

        {view === "oracle" && (
          <>
            <ViewHero title="Oracle Manager" subtitle="Keeper-managed mock oracle status for testnet vault accounting." />
            <AdminPanel data={data} loading={loading} address={address} isOperator={isOperator} focus="oracle" onSweepFees={runSweepFees} sweepingSymbol={sweepingSymbol} />
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
          preview={preview}
          previewLoading={previewLoading}
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
          <span><Database size={15} /> Invariant PASS</span>
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
        <p>Deposit supported stock tokens and withdraw the original deposited token from your ledger balance.</p>
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

function SummaryLedger({ data, loading, refresh, openModal, isConnected, isRightChain }) {
  const hasReadIssue = Boolean(data.readIssue);

  return (
    <section id="ledger" className="panel">
      <div className="sectionHead">
        <div>
          <h2>Vault Ledger</h2>
          <p>Ledger-based positions per deposited asset.</p>
        </div>
        <button className="secondaryBtn" onClick={refresh}>
          {loading ? <><Loader2 className="spin" size={15} /> Reading...</> : "Refresh"}
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

      {hasReadIssue && (
        <div className="ledgerNotice readIssue">
          <strong>RPC retry</strong>
          <span>{data.readIssue}</span>
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
                    {hasReadIssue ? "RPC retry" : fresh === false ? "Oracle stale" : fresh === true ? "Oracle fresh" : "Oracle check"}
                  </em>
                </div>
              </div>

              <div className="assetData">
                <div>
                  <span>Oracle price</span>
                  <strong>{loading ? "Reading..." : hasReadIssue ? "RPC retry" : formatUsd(data.prices[token.symbol] || token.fallbackPrice)}</strong>
                </div>
                <div>
                  <span>Wallet</span>
                  <strong>
                    {loading
                      ? "Reading..."
                      : hasReadIssue
                        ? "RPC retry"
                        : isConnected
                          ? `${formatAmount(data.walletBalances[token.symbol] || 0n, token.decimals)} ${token.symbol}`
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

function TreasuryPanel({ data, isOperator, isConnected, isRightChain, onSweepFees, sweepingSymbol }) {
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
          const pendingForSweep = data.pendingFees[token.symbol] || 0n;

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
                  <strong>{formatAmount(data.totalDeposits[token.symbol] || 0n, token.decimals, 4)} {token.symbol}</strong>
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

      <RewardPanel />

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
        <span>Invariant: PASS</span>
        <span>Checks: LIVE</span>
        <span>Failures: NONE</span>
      </div>
    </section>
  );
}

function AdminPanel({ data, loading, address, isOperator, focus, onSweepFees, sweepingSymbol }) {
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

    return Number.isFinite(amount) && Number.isFinite(price)
      ? sum + amount * price
      : sum;
  }, 0);

  const totalDepositsUsd = TOKENS.reduce((sum, token) => {
    const raw = data?.totalDeposits?.[token.symbol] || 0n;
    const amount = Number(formatUnits(raw, token.decimals));
    const price = data?.prices?.[token.symbol] || token.fallbackPrice || 0;

    return Number.isFinite(amount) && Number.isFinite(price)
      ? sum + amount * price
      : sum;
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
          <p>
            Emergency controls remain contract-level operator functions and are not
            exposed through the public interface.
          </p>
          <button disabled>Contract controlled</button>
        </div>
        <div>
          <strong>Operator Actions</strong>
          <p>
            Treasury sweeping is the only routine operator action exposed in the
            public dashboard.
          </p>
          <button disabled>Configured</button>
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
  preview,
  previewLoading,
  closeModal,
  onConfirm,
  writeBusy,
  isConnected,
  isRightChain,
}) {
  function handleClose(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    closeModal();
  }

  function handleConfirm(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    onConfirm();
  }

  const normalizedAmount = normalizeAmountInput(amount);
  const inputAmount = Number(normalizedAmount);
  const safeAmount = Number.isFinite(inputAmount) && inputAmount > 0 ? inputAmount : 0;

  const previewValues = Array.isArray(preview?.values) ? preview.values : [];

  const hasPreview = Boolean(preview && !preview.error && previewValues.length > 0);

  // Fallback UI estimate only. Contract preview is preferred whenever available.
  const depositFeeRate = 0.005;
  const withdrawFeeRate = 0.002;
  const activeFeeRate = modal === "deposit" ? depositFeeRate : withdrawFeeRate;
  const fallbackFeeAmount = safeAmount * activeFeeRate;
  const fallbackCreditedAmount = Math.max(safeAmount - fallbackFeeAmount, 0);
  const fallbackReceiptUsd = estimateUsd * (1 - depositFeeRate);

  const previewFeeAmount = hasPreview ? previewValues[0] : null;
  const previewTokenAmount = hasPreview ? previewValues[1] : null;
  const previewReceiptAmount = hasPreview ? previewValues[2] : null;

  const protocolFeeText =
    previewLoading
      ? "Reading..."
      : safeAmount <= 0
        ? "—"
        : typeof previewFeeAmount === "bigint"
          ? `${formatAmount(previewFeeAmount, selectedToken.decimals, 6)} ${selectedToken.symbol}`
          : `≈ ${formatPreviewNumber(fallbackFeeAmount)} ${selectedToken.symbol}`;

  const expectedText =
    previewLoading
      ? "Reading..."
      : safeAmount <= 0
        ? "—"
        : modal === "deposit"
          ? typeof previewReceiptAmount === "bigint"
            ? `${formatAmount(previewReceiptAmount, 18, 6)} rINDEX`
            : `≈ ${formatPreviewNumber(fallbackReceiptUsd, 4)} rINDEX`
          : typeof previewTokenAmount === "bigint"
            ? `${formatAmount(previewTokenAmount, selectedToken.decimals, 6)} ${selectedToken.symbol}`
            : `≈ ${formatPreviewNumber(fallbackCreditedAmount)} ${selectedToken.symbol}`;

  const secondaryText =
    previewLoading
      ? "Reading..."
      : safeAmount <= 0
        ? "—"
        : modal === "deposit"
          ? typeof previewTokenAmount === "bigint"
            ? `${formatAmount(previewTokenAmount, selectedToken.decimals, 6)} ${selectedToken.symbol}`
            : `≈ ${formatPreviewNumber(fallbackCreditedAmount)} ${selectedToken.symbol}`
          : typeof previewReceiptAmount === "bigint"
            ? `${formatAmount(previewReceiptAmount, 18, 6)} rINDEX`
            : `≈ ${formatPreviewNumber(estimateUsd, 4)} rINDEX`;

  return (
    <div className="modalWrap" onPointerDown={(event) => {
      if (event.target === event.currentTarget) {
        handleClose(event);
      }
    }}>
      <div className="modal" onPointerDown={(event) => event.stopPropagation()}>
        <div className="modalHead">
          <div>
            <h3>{modal === "deposit" ? "Deposit" : "Withdraw"} {selectedToken.symbol}</h3>
            <p>{modal === "deposit" ? "Deposit stock tokens into the vault ledger." : "Withdraw the original token from your vault ledger."}</p>
          </div>
          <button
            type="button"
            className="iconBtn"
            aria-label="Close modal"
            onPointerDown={handleClose}
            onClick={handleClose}
          >
            <X size={18} />
          </button>
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
          <div><span>{modal === "deposit" ? "Credited amount" : "rINDEX burn"}</span><strong>{secondaryText}</strong></div>
        </div>

        <button
          type="button"
          className="primaryBtn wide"
          disabled={writeBusy || !isConnected || !isRightChain || !amount}
          onClick={handleConfirm}
        >
          {writeBusy
            ? "Confirming..."
            : modal === "deposit"
              ? "Approve + Deposit"
              : "Confirm Withdraw"}
        </button>

        <p className="fineprint">
          Estimates are shown for responsiveness. Final fee, rINDEX mint, and withdrawal values are enforced by the verified contract. No APY, no guaranteed yield.
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
