import { useMemo, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import {
  CheckCircle2,
  Database,
  ExternalLink,
  Lock,
  Menu,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import { ADDRESSES, CHAIN_ID, EXPLORER, OPERATORS } from "./contracts/addresses";
import { TOKENS } from "./contracts/tokens";
import { shortAddress, explorerAddress, formatUsd } from "./lib/contracts";
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

function App() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [view, setView] = useState("overview");
  const [modal, setModal] = useState(null);
  const [selectedToken, setSelectedToken] = useState(TOKENS[0]);
  const [amount, setAmount] = useState("");

  const isRightChain = chainId === CHAIN_ID;

  const isOperator = useMemo(() => {
    return address && OPERATORS.includes(address.toLowerCase());
  }, [address]);

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

  const estimateUsd = Number(amount || 0) * selectedToken.fallbackPrice;

  return (
    <div className="app">
      <div className="glow glowA" />
      <div className="glow glowB" />

      <header className="topbar">
        <div className="brand">
          <div className="brandIcon">R</div>
          <div>
            <strong>Robin Index</strong>
            <span>Vault Terminal</span>
          </div>
        </div>

        <div className="topActions">
          <div className={isRightChain ? "chainOk" : "chainBad"}>
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
                <button
                  key={key}
                  className={view === key ? "active" : ""}
                  onClick={() => go(key)}
                >
                  {label}
                </button>
              ))}

              {isOperator && (
                <>
                  <div className="drawerSep" />
                  {ADMIN_VIEWS.map(([key, label]) => (
                    <button
                      key={key}
                      className={view === key ? "active" : ""}
                      onClick={() => go(key)}
                    >
                      {label}
                    </button>
                  ))}
                </>
              )}

              <div className="drawerSep" />

              <a href="https://github.com/Agus-ops/robin-index-vault" target="_blank" rel="noreferrer">
                GitHub <ExternalLink size={14} />
              </a>
              <a href="https://github.com/Agus-ops/robin-index-vault/releases/tag/v0.2.0" target="_blank" rel="noreferrer">
                Release v0.2.0 <ExternalLink size={14} />
              </a>
            </nav>
          </aside>
        </>
      )}

      <main>
        {view === "overview" && (
          <>
            <Hero isRightChain={isRightChain} isConnected={isConnected} switchChain={switchChain} />
            <LandingOverview go={go} />
          </>
        )}

        {view === "ledger" && (
          <>
            <ViewHero
              title="Vault Ledger"
              subtitle="Deposit and withdraw supported testnet stock tokens from your ledger-based vault position."
            />
            <SummaryLedger openModal={openModal} isConnected={isConnected} isRightChain={isRightChain} />
          </>
        )}

        {view === "rindex" && (
          <>
            <ViewHero
              title="rINDEX Balance"
              subtitle="Your non-transferable receipt token for ledger-based vault deposits."
            />
            <div className="singlePanel">
              <PortfolioPanel />
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
              <TreasuryPanel />
            </div>
          </>
        )}

        {view === "contracts" && (
          <>
            <ViewHero
              title="Verified Contracts"
              subtitle="All core v0.2.0 contracts are verified on Robinhood Chain Testnet explorer."
            />
            <div className="singlePanel">
              <ContractsPanel />
            </div>
          </>
        )}

        {view === "admin" && (
          <>
            <ViewHero
              title="Operator Control Room"
              subtitle="Admin-only tools stay hidden from normal users."
            />
            <AdminPanel isOperator={isOperator} />
          </>
        )}

        {view === "oracle" && (
          <>
            <ViewHero
              title="Oracle Manager"
              subtitle="Admin-only mock oracle controls for the testnet deployment."
            />
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
        />
      )}
    </div>
  );
}

function Hero({ isRightChain, isConnected, switchChain }) {
  return (
    <section className="hero">
      <div>
        <div className="eyebrow">Robinhood Chain Testnet · Chain ID 46630</div>
        <h1>Robin Index Vault v0.3.0</h1>
        <p>
          A premium interface for the verified v0.2.0 ledger-based vault.
          Deposit testnet stock tokens, receive non-transferable rINDEX,
          and withdraw the original deposited token.
        </p>

        <div className="badges">
          <span><ShieldCheck size={15} /> Verified deployment</span>
          <span><CheckCircle2 size={15} /> Smoke tested</span>
          <span><Database size={15} /> Invariant 65 / 0 / 0</span>
        </div>
      </div>

      <div className="heroCard">
        <span>Network status</span>
        <strong>{isRightChain ? "Ready" : "Switch required"}</strong>
        <p>{isRightChain ? "Connected to Robinhood Chain Testnet." : "Switch wallet network before transactions."}</p>

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
        <p>
          Deposit supported testnet stock tokens and withdraw the original deposited token
          from your ledger balance.
        </p>
        <button className="primaryBtn" onClick={() => go("ledger")}>
          Open Vault Ledger
        </button>
      </article>

      <article className="landingCard">
        <span className="cardKicker">Receipt token</span>
        <h2>Non-transferable rINDEX</h2>
        <p>
          rINDEX acts as a non-transferable receipt for your vault position.
          It is not a tradable yield token.
        </p>
        <button className="secondaryBtn" onClick={() => go("rindex")}>
          View rINDEX
        </button>
      </article>

      <article className="landingCard">
        <span className="cardKicker">Protocol fees</span>
        <h2>Treasury buckets</h2>
        <p>
          Fees are split into reserve, rewards, router liquidity, and operator buckets.
          Rewards are fee-funded only.
        </p>
        <button className="secondaryBtn" onClick={() => go("treasury")}>
          View Treasury
        </button>
      </article>

      <article className="landingCard">
        <span className="cardKicker">Public trust</span>
        <h2>Verified v0.2.0 deployment</h2>
        <p>
          All core contracts are verified, smoke tested, and passed runtime invariant checks:
          65 passes, 0 warnings, 0 failures.
        </p>
        <button className="secondaryBtn" onClick={() => go("contracts")}>
          View Contracts
        </button>
      </article>

      <article className="landingCard wideLanding">
        <div className="miniStats">
          <div><span>Verified</span><strong>5 / 5</strong></div>
          <div><span>Smoke</span><strong>PASS</strong></div>
          <div><span>Invariant</span><strong>65 / 0 / 0</strong></div>
          <div><span>Network</span><strong>46630</strong></div>
        </div>
      </article>
    </section>
  );
}

function SummaryLedger({ openModal, isConnected, isRightChain }) {
  return (
    <section id="ledger" className="panel">
      <div className="sectionHead">
        <div>
          <h2>Vault Ledger</h2>
          <p>Ledger-based positions per deposited asset.</p>
        </div>
        <span className="softPill">Testnet MVP</span>
      </div>

      <div className="assetList">
        {TOKENS.map((token) => (
          <article className="assetCard" key={token.symbol}>
            <div className="assetMain">
              <div className="tokenMark">{token.symbol.slice(0, 1)}</div>
              <div>
                <strong>{token.symbol}</strong>
                <span>{token.name}</span>
              </div>
            </div>

            <div className="assetData">
              <div>
                <span>Oracle price</span>
                <strong>{formatUsd(token.fallbackPrice)}</strong>
              </div>
              <div>
                <span>Wallet</span>
                <strong>Connect wallet</strong>
              </div>
              <div>
                <span>Vault ledger</span>
                <strong>Read wiring next</strong>
              </div>
            </div>

            <div className="assetActions">
              <button disabled={!isConnected || !isRightChain} onClick={() => openModal("deposit", token)}>
                Deposit
              </button>
              <button disabled={!isConnected || !isRightChain} onClick={() => openModal("withdraw", token)}>
                Withdraw
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function PortfolioPanel() {
  return (
    <section id="rindex" className="panel metricPanel">
      <div className="sectionHead">
        <div>
          <h2>Your Vault Portfolio</h2>
          <p>Read-only preview until wallet data wiring is completed.</p>
        </div>
        <Wallet size={20} />
      </div>

      <div className="bigNumber">—</div>

      <div className="rindexBox">
        <span>rINDEX Balance</span>
        <strong>Connect wallet</strong>
        <em><Lock size={13} /> Non-transferable receipt</em>
      </div>

      <p className="fineprint">
        Withdraw returns the original deposited token from your ledger balance.
      </p>
    </section>
  );
}

function TreasuryPanel() {
  return (
    <section id="treasury" className="panel">
      <div className="sectionHead">
        <div>
          <h2>Treasury & Rewards</h2>
          <p>Rewards are fee-funded only. No guaranteed yield.</p>
        </div>
      </div>

      <Bucket label="Protocol Reserve" pct={50} />
      <Bucket label="User Rewards Pool" pct={30} />
      <Bucket label="Router Liquidity" pct={15} />
      <Bucket label="Admin Ops" pct={5} />

      <p className="fineprint">
        Fee buckets reflect protocol design: 50 / 30 / 15 / 5.
      </p>
    </section>
  );
}

function ContractsPanel() {
  return (
    <section id="contracts" className="panel">
      <div className="sectionHead">
        <div>
          <h2>Verified Contracts</h2>
          <p>All core contracts verified on explorer.</p>
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
          <p>Admin-only panel. Hidden for normal users.</p>
        </div>
        <span className="dangerPill">Admin</span>
      </div>

      <div className="adminGrid">
        <div>
          <strong>Oracle Manager</strong>
          <p>Update token prices from verified oracle contract.</p>
          <button disabled>Wiring next</button>
        </div>
        <div>
          <strong>Treasury Sweep</strong>
          <p>Sweep pending protocol fees into treasury buckets.</p>
          <button disabled>Wiring next</button>
        </div>
        <div>
          <strong>Emergency</strong>
          <p>Pause controls for testnet safety only.</p>
          <button disabled>Pause wiring next</button>
        </div>
      </div>
    </section>
  );
}

function ActionModal({ modal, selectedToken, amount, setAmount, estimateUsd, closeModal }) {
  return (
    <div className="modalWrap">
      <div className="modal">
        <div className="modalHead">
          <div>
            <h3>{modal === "deposit" ? "Deposit" : "Withdraw"} {selectedToken.symbol}</h3>
            <p>This is a testnet stock-token vault MVP.</p>
          </div>
          <button className="iconBtn" onClick={closeModal}><X size={18} /></button>
        </div>

        <label className="amountLabel">
          Amount
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            inputMode="decimal"
          />
        </label>

        <div className="breakdown">
          <div><span>Selected asset</span><strong>{selectedToken.symbol}</strong></div>
          <div><span>Estimated USD value</span><strong>{formatUsd(estimateUsd)}</strong></div>
          <div><span>Protocol fee</span><strong>Contract-enforced</strong></div>
          <div><span>{modal === "deposit" ? "Expected receipt" : "Expected burn"}</span><strong>Calculated by vault</strong></div>
        </div>

        <button className="primaryBtn wide" disabled>
          Contract write wiring next
        </button>

        <p className="fineprint">
          rINDEX is non-transferable. Rewards are fee-funded only. No APY, no guaranteed yield.
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
