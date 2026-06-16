import { useState, useEffect } from "react";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseAbi } from "viem";
import { ADDRESSES } from "../contracts/addresses";

// ABI diisolasi di dalam komponen agar App.jsx bersih
const VAULT_CHECKIN_ABI = parseAbi([
  "function lastRebalanceAt(address) view returns (uint256)",
  "function dailyRebalanceCheck(string) returns (bytes32)"
]);

export function DailyCheckIn({ isConnected, isRightChain }) {
  const { address } = useAccount();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const { data: lastAt, refetch: refetchLast } = useReadContract({
    address: ADDRESSES.vault,
    abi: VAULT_CHECKIN_ABI,
    functionName: "lastRebalanceAt",
    args: [address || "0x0000000000000000000000000000000000000000"],
    query: { enabled: Boolean(address) },
  });

  const { writeContract, data: txHash, isPending, error: writeError, reset } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
    query: { enabled: Boolean(txHash) },
  });

  useEffect(() => {
    if (isSuccess) {
      refetchLast();
      reset();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess]);

  const lastTs = lastAt ? Number(lastAt) : 0;
  const cooldownEnd = lastTs + 86400;
  const inCooldown = lastTs > 0 && now < cooldownEnd;
  const remaining = cooldownEnd - now;

  function fmt(secs) {
    const h = Math.floor(secs / 3600).toString().padStart(2, "0");
    const m = Math.floor((secs % 3600) / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${h}:${m}:${s}`;
  }

  function fmtDate(ts) {
    if (!ts) return "Never";
    return new Date(ts * 1000).toLocaleString("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  const canCheckIn = isConnected && isRightChain && !inCooldown && !isPending && !isConfirming;

  function onCheckIn() {
    writeContract({
      address: ADDRESSES.vault,
      abi: VAULT_CHECKIN_ABI,
      functionName: "dailyRebalanceCheck",
      args: ["web-check-in"],
    });
  }

  return (
    <div className="checkInPanel">
      <div className="checkInLeft">
        <span className="checkInEyebrow">Daily Check-In</span>
        <div className="checkInStatus">
          {!isConnected
            ? "Connect wallet to check in"
            : inCooldown
              ? <><strong>{fmt(remaining)}</strong> until next check-in</>
              : lastTs === 0
                ? "No check-in recorded yet"
                : "Ready to check in!"}
        </div>
        {lastTs > 0 && (
          <span className="checkInLast">Last: {fmtDate(lastTs)}</span>
        )}
        {isSuccess && <span className="checkInSuccess">✓ Check-in confirmed!</span>}
        {writeError && <span className="checkInError">{writeError.shortMessage || "Transaction failed"}</span>}
      </div>
      <button
        className="checkInBtn"
        disabled={!canCheckIn}
        onClick={onCheckIn}
      >
        {isPending || isConfirming ? "Confirming..." : inCooldown ? "Checked In" : "Check In"}
      </button>
    </div>
  );
}
