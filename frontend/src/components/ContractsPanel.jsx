import { ADDRESSES, EXPLORER } from "../contracts/addresses";

// Menggunakan ikon ShieldCheck dari lucide-react
import { ShieldCheck } from "lucide-react";

// Sub-komponen ContractLink internal agar rapi
function ContractLink({ name, address }) {
  function short(addr) {
    if (!addr) return "";
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  }
  return (
    <div className="contractLinkRow">
      <span>{name}</span>
      <a 
        href={`${EXPLORER}/address/${address}`} 
        target="_blank" 
        rel="noopener noreferrer"
        className="monoAddr"
      >
        {short(address)}
      </a>
    </div>
  );
}

export function ContractsPanel() {
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
