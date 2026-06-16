import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import "./styles.css";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { formatUnits, parseUnits } from "viem";
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import {
  CheckCircle2,
  Database,
  ExternalLink,
  Menu,
  ShieldCheck,
  X,
} from "lucide-react";
import { ADDRESSES, CHAIN_ID, EXPLORER, OPERATORS } from "./contracts/addresses";
import { TOKENS } from "./contracts/tokens";
import { ABIS } from "./contracts/generated";
import {
  ERC20_ABI,
  explorerTx,
  formatAmount,
  formatUsd,
  getFirstBigInt,
  shortAddress,
} from "./lib/contracts";
import { AdminPanel } from "./components/AdminPanel";
import { ContractsPanel } from "./components/ContractsPanel";
import { LandingOverview } from "./components/LandingOverview";
import { Leaderboard } from "./components/Leaderboard";
import { PortfolioPanel } from "./components/PortfolioPanel";
import { SummaryLedger } from "./components/SummaryLedger";
import { TreasuryPanel } from "./components/TreasuryPanel";

const USER_VIEWS = [
  ["overview", "Dashboard"],
  ["ledger", "Vault Ledger"],
  ["rindex", "Portfolio"],
  ["treasury", "Treasury"],
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

  const loadVaultData = useCallback(async () => {
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, publicClient]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadVaultData();
  }, [loadVaultData, refreshNonce]);

  useEffect(() => {
    if (!publicClient) return;

    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (modal || sweepingSymbol) return;

      loadVaultData();
    }, 60000);

    return () => window.clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, publicClient, modal, sweepingSymbol]);

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
    previewCallId.current += 1;
    if (document.activeElement && typeof document.activeElement.blur === "function") {
      document.activeElement.blur();
    }

    setModal(null);
    setAmount("");
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
        <div className={isConnected && isRightChain ? "chainOk" : "chainBad"}>
          <span />
          {isRightChain ? "Robinhood Testnet" : "Wrong Network"}
        </div>

        <div className="topActions">
          <ConnectButton />

          <button className="iconBtn" onClick={() => setDrawerOpen(true)} aria-label="Open menu">
            <Menu size={22} />
          </button>
        </div>
      </header>

      {drawerOpen && (
        <>
          <button className="overlay" onClick={() => setDrawerOpen(false)} aria-label="Close overlay" />
          <aside className="drawer bottomSheet">
            <div className="sheetHandle" />
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
            <LandingOverview go={go} data={data} loading={loading} />
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
              title="Portfolio & Leaderboard"
              subtitle="Your vault portfolio, rINDEX receipt, and protocol leaderboard."
            />
            <div className="singlePanel">
              <PortfolioPanel data={data} isConnected={isConnected} loading={loading} />
              <Leaderboard />
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

function Hero() {
  return (
    <section className="hero">
      <div>
        <div className="eyebrow">Robinhood Chain Testnet · Chain ID 46630</div>
        <h1>Robin Index Vault</h1>
        <p>Deposit testnet stock tokens into a verified on-chain vault, receive non-transferable rINDEX receipts, and earn fee-funded protocol rewards. No fixed APY. No minting. Full on-chain transparency.</p>

        <div className="badges">
          <span><ShieldCheck size={15} /> Verified deployment</span>
          <span><CheckCircle2 size={15} /> Smoke tested</span>
          <span><Database size={15} /> Invariant PASS</span>
        </div>
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



export default App;
