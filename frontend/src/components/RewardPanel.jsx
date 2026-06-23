import { useMemo, useState } from "react";
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { formatUnits, parseAbi, isAddress } from "viem";

import { ADDRESSES } from "../contracts/addresses";
const TREASURY = ADDRESSES.treasury;
const REWARD_DISTRIBUTOR = ADDRESSES.rewardDistributor;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const BUCKET_REWARDS = 1;

import { TOKENS } from "../contracts/tokens";

const treasuryAbi = parseAbi([
  "function bucketBalance(address token,uint8 bucket) view returns (uint256)",
  "function distributionThreshold(address token) view returns (uint256)",
  "function canDistribute(address token) view returns (bool)",
]);

const rewardAbi = parseAbi([
  "function currentWeek() view returns (uint256)",
  "function tokenConfig(address token) view returns (bool enabled,uint256 absoluteWeeklyCap)",
  "function weekFunded(address token,uint256 week) view returns (uint256)",
  "function weekClaimedTotal(address token,uint256 week) view returns (uint256)",
  "function tokenTotalFunded(address token) view returns (uint256)",
  "function tokenTotalClaimed(address token) view returns (uint256)",
  "function claimed(address user,address token,uint256 week) view returns (bool)",
  "function claim(address token,uint256 week,uint256 amount,bytes32[] proof)",
]);

const erc20Abi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
]);

function fmt(value, decimals = 18, maxDecimals = 8) {
  if (value === undefined || value === null) return "—";
  try {
    const out = formatUnits(value, decimals);
    const [whole, frac = ""] = out.split(".");
    const trimmed = frac.replace(/0+$/, "").slice(0, maxDecimals);
    return trimmed ? `${whole}.${trimmed}` : whole;
  } catch {
    return "—";
  }
}

function shortAddress(value) {
  if (!value) return "Not connected";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function parseProofInput(raw) {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isValidBytes32(s) {
  return /^0x[0-9a-fA-F]{64}$/.test(s);
}

export default function RewardPanel() {
  const { address, isConnected } = useAccount();
  const viewer = address || ZERO_ADDRESS;
  const queryClient = useQueryClient();

  // Per-token manual claim input state: { [symbol]: { amount, proofRaw } }
  const [claimInputs, setClaimInputs] = useState({});

  const { data: currentWeek, isLoading: weekLoading } = useReadContract({
    address: REWARD_DISTRIBUTOR,
    abi: rewardAbi,
    functionName: "currentWeek",
  });

  const contracts = useMemo(() => {
    if (currentWeek === undefined) return [];
    return TOKENS.flatMap((token) => [
      { address: TREASURY, abi: treasuryAbi, functionName: "bucketBalance", args: [token.address, BUCKET_REWARDS] },
      { address: TREASURY, abi: treasuryAbi, functionName: "distributionThreshold", args: [token.address] },
      { address: TREASURY, abi: treasuryAbi, functionName: "canDistribute", args: [token.address] },
      { address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [REWARD_DISTRIBUTOR] },
      { address: REWARD_DISTRIBUTOR, abi: rewardAbi, functionName: "tokenConfig", args: [token.address] },
      { address: REWARD_DISTRIBUTOR, abi: rewardAbi, functionName: "weekFunded", args: [token.address, currentWeek] },
      { address: REWARD_DISTRIBUTOR, abi: rewardAbi, functionName: "weekClaimedTotal", args: [token.address, currentWeek] },
      { address: REWARD_DISTRIBUTOR, abi: rewardAbi, functionName: "tokenTotalFunded", args: [token.address] },
      { address: REWARD_DISTRIBUTOR, abi: rewardAbi, functionName: "tokenTotalClaimed", args: [token.address] },
      { address: REWARD_DISTRIBUTOR, abi: rewardAbi, functionName: "claimed", args: [viewer, token.address, currentWeek] },
    ]);
  }, [currentWeek, viewer]);

  const { data: reads, isLoading } = useReadContracts({
    contracts,
    query: { enabled: contracts.length > 0 },
  });

  const { writeContract, data: txHash, isPending, error } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
    query: { enabled: Boolean(txHash) },
  });

  const rows = useMemo(() => {
    if (!reads || reads.length === 0) return [];
    return TOKENS.map((token, i) => {
      const base = i * 9;
      const tokenConfig = reads[base + 4]?.result;
      const enabled = Array.isArray(tokenConfig) ? tokenConfig[0] : false;
      const cap = Array.isArray(tokenConfig) ? tokenConfig[1] : 0n;
      return {
        ...token,
        treasuryRewards: reads[base]?.result,
        threshold: reads[base + 1]?.result,
        canDistribute: reads[base + 2]?.result,
        rewardBalance: reads[base + 3]?.result,
        enabled,
        cap,
        weekFunded: reads[base + 5]?.result,
        weekClaimed: reads[base + 6]?.result,
        totalFunded: reads[base + 7]?.result,
        totalClaimed: reads[base + 8]?.result,
        alreadyClaimed: reads[base + 9]?.result === true,
      };
    });
  }, [reads]);

  function updateInput(symbol, field, value) {
    setClaimInputs((prev) => ({
      ...prev,
      [symbol]: { ...prev[symbol], [field]: value },
    }));
  }

  function onClaim(token) {
    if (currentWeek === undefined) return;
    const input = claimInputs[token.symbol] || {};
    const amountStr = (input.amount || "").trim();
    const proofArr = parseProofInput(input.proofRaw);

    if (!amountStr || isNaN(Number(amountStr)) || Number(amountStr) <= 0) {
      alert("Masukkan amount yang valid (sesuai unit terkecil token, contoh 1000000 untuk 1 USDG).");
      return;
    }
    if (proofArr.length === 0) {
      alert("Masukkan Merkle proof (array bytes32, pisahkan dengan koma atau baris baru).");
      return;
    }
    const invalid = proofArr.find((p) => !isValidBytes32(p));
    if (invalid) {
      alert(`Proof tidak valid: ${invalid}\nSetiap proof harus format 0x + 64 karakter hex.`);
      return;
    }

    writeContract({
      address: REWARD_DISTRIBUTOR,
      abi: rewardAbi,
      functionName: "claim",
      args: [token.address, currentWeek, BigInt(amountStr), proofArr],
    });
  }

  const [isRefreshing, setIsRefreshing] = useState(false);

  async function refreshAll() {
    setIsRefreshing(true);
    await queryClient.invalidateQueries();
    setTimeout(() => setIsRefreshing(false), 1500);
  }

  return (
    <section className="rewardPanelClean">
      <div className="rewardPanelHead">
        <div>
          <p className="rewardEyebrow">Fee-funded rewards · Merkle claim</p>
          <h2>Reward Status</h2>
          <p className="rewardMuted">
            Rewards are now distributed via Merkle tree. Enter your amount and proof
            (obtained from the rewards API/backend) to claim.
          </p>
        </div>
        <button className="rewardRefreshButton" type="button" onClick={refreshAll} disabled={isRefreshing}>
          {isRefreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="rewardSummaryGrid">
        <div className="rewardSummaryCard">
          <span>Reward cycle</span>
          <strong>{weekLoading ? "Loading…" : currentWeek !== undefined ? (() => {
  const weekMs = Number(currentWeek) * 7 * 24 * 60 * 60 * 1000;
  const start = new Date(weekMs);
  const end = new Date(weekMs + 6 * 24 * 60 * 60 * 1000);
  const fmt = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(start)} – ${fmt(end)}, ${end.getFullYear()}`;
})() : "—"}</strong>
        </div>
        <div className="rewardSummaryCard">
          <span>Connected wallet</span>
          <strong>{isConnected ? shortAddress(address) : "Not connected"}</strong>
        </div>
        <div className="rewardSummaryCard">
          <span>Reward contract</span>
          <strong>{shortAddress(REWARD_DISTRIBUTOR)}</strong>
        </div>
      </div>

      {isLoading && <div className="rewardLoading">Loading reward state…</div>}

      {!isLoading && (
        <div className="rewardAssetGrid">
          {rows.map((row) => {
            const input = claimInputs[row.symbol] || {};
            const canClaim = isConnected && !row.alreadyClaimed && !isPending && !isConfirming;
            return (
              <article className="rewardAssetCard" key={row.symbol}>
                <div className="rewardAssetTop">
                  <div>
                    <strong className="rewardSymbol">{row.symbol}</strong>
                    <span className="rewardSubtext">Reward asset</span>
                  </div>
                  <div className="rewardBadgeRow">
                    <span className={row.enabled ? "rewardBadge rewardBadgeOk" : "rewardBadge"}>
                      {row.enabled ? "Enabled" : "Inactive"}
                    </span>
                    <span className={row.canDistribute ? "rewardBadge rewardBadgeInfo" : "rewardBadge"}>
                      {row.canDistribute ? "Distributable" : "Below threshold"}
                    </span>
                    {row.alreadyClaimed && (
                      <span className="rewardBadge rewardBadgeOk">Claimed this week</span>
                    )}
                  </div>
                </div>

                <div className="rewardMetricGrid">
                  <div className="rewardMetric">
                    <span>Treasury rewards</span>
                    <strong>{fmt(row.treasuryRewards, row.decimals)}</strong>
                  </div>
                  <div className="rewardMetric">
                    <span>Weekly cap</span>
                    <strong>{fmt(row.cap, row.decimals)}</strong>
                  </div>
                  <div className="rewardMetric">
                    <span>Week funded</span>
                    <strong>{fmt(row.weekFunded, row.decimals)}</strong>
                  </div>
                  <div className="rewardMetric">
                    <span>Week claimed</span>
                    <strong>{fmt(row.weekClaimed, row.decimals)}</strong>
                  </div>
                </div>

                <div className="rewardClaimRow" style={{ flexDirection: "column", alignItems: "stretch", gap: "8px" }}>
                  <input
                    type="text"
                    placeholder={`Amount (smallest unit, e.g. ${row.decimals === 6 ? "1000000" : "1000000000000000000"})`}
                    value={input.amount || ""}
                    onChange={(e) => updateInput(row.symbol, "amount", e.target.value)}
                    disabled={!canClaim}
                    style={{ padding: "8px", borderRadius: "8px", border: "1px solid #333", background: "#0d0d0d", color: "#eee" }}
                  />
                  <textarea
                    placeholder="Merkle proof (bytes32[], pisahkan koma/baris baru)"
                    value={input.proofRaw || ""}
                    onChange={(e) => updateInput(row.symbol, "proofRaw", e.target.value)}
                    disabled={!canClaim}
                    rows={3}
                    style={{ padding: "8px", borderRadius: "8px", border: "1px solid #333", background: "#0d0d0d", color: "#eee", fontFamily: "monospace", fontSize: "12px" }}
                  />
                  <button
                    className="rewardClaimButton"
                    type="button"
                    disabled={!canClaim}
                    onClick={() => onClaim(row)}
                  >
                    {isPending || isConfirming ? "Claiming…" : row.alreadyClaimed ? "Already claimed" : "Claim"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {isSuccess && <p className="rewardSuccess">✓ Claim confirmed. Data refreshed.</p>}
      {error && <p className="rewardError">{error.shortMessage || error.message}</p>}
    </section>
  );
}
