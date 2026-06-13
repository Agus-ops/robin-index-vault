import { useMemo } from "react";
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { formatUnits, parseAbi } from "viem";

const TREASURY = "0xf5579396bFaEd22a14fF43d09eD490ae78784211";
const REWARD_DISTRIBUTOR = "0x30a6dDfCf8e1Fa11Ce5B2A9745c54123A74e0d15";

const BUCKET_REWARDS = 1;

const TOKENS = [
  {
    symbol: "TSLA",
    address: "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E",
    decimals: 18,
  },
  {
    symbol: "AMZN",
    address: "0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02",
    decimals: 18,
  },
  {
    symbol: "NFLX",
    address: "0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93",
    decimals: 18,
  },
  {
    symbol: "PLTR",
    address: "0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0",
    decimals: 18,
  },
  {
    symbol: "AMD",
    address: "0x71178BAc73cBeb415514eB542a8995b82669778d",
    decimals: 18,
  },
];

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
  "function allocation(address user,address token,uint256 week) view returns (uint256)",
  "function claimed(address user,address token,uint256 week) view returns (uint256)",
  "function claimable(address user,address token,uint256 week) view returns (uint256)",
  "function claim(address token,uint256 week)",
]);

const erc20Abi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
]);

function fmt(value, decimals = 18) {
  if (value === undefined || value === null) return "—";
  try {
    const out = formatUnits(value, decimals);
    const [a, b = ""] = out.split(".");
    const trimmed = b.replace(/0+$/, "").slice(0, 8);
    return trimmed ? `${a}.${trimmed}` : a;
  } catch {
    return "—";
  }
}

function isPositive(value) {
  return typeof value === "bigint" && value > 0n;
}

export default function RewardPanel() {
  const { address, isConnected } = useAccount();

  const {
    data: currentWeek,
    isLoading: weekLoading,
    refetch: refetchWeek,
  } = useReadContract({
    address: REWARD_DISTRIBUTOR,
    abi: rewardAbi,
    functionName: "currentWeek",
    query: {
      refetchInterval: 30_000,
    },
  });

  const contracts = useMemo(() => {
    if (currentWeek === undefined || !address) return [];

    return TOKENS.flatMap((token) => [
      {
        address: TREASURY,
        abi: treasuryAbi,
        functionName: "bucketBalance",
        args: [token.address, BUCKET_REWARDS],
      },
      {
        address: TREASURY,
        abi: treasuryAbi,
        functionName: "distributionThreshold",
        args: [token.address],
      },
      {
        address: TREASURY,
        abi: treasuryAbi,
        functionName: "canDistribute",
        args: [token.address],
      },
      {
        address: token.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [REWARD_DISTRIBUTOR],
      },
      {
        address: REWARD_DISTRIBUTOR,
        abi: rewardAbi,
        functionName: "tokenConfig",
        args: [token.address],
      },
      {
        address: REWARD_DISTRIBUTOR,
        abi: rewardAbi,
        functionName: "weekFunded",
        args: [token.address, currentWeek],
      },
      {
        address: REWARD_DISTRIBUTOR,
        abi: rewardAbi,
        functionName: "weekClaimedTotal",
        args: [token.address, currentWeek],
      },
      {
        address: REWARD_DISTRIBUTOR,
        abi: rewardAbi,
        functionName: "tokenTotalFunded",
        args: [token.address],
      },
      {
        address: REWARD_DISTRIBUTOR,
        abi: rewardAbi,
        functionName: "tokenTotalClaimed",
        args: [token.address],
      },
      {
        address: REWARD_DISTRIBUTOR,
        abi: rewardAbi,
        functionName: "allocation",
        args: [address, token.address, currentWeek],
      },
      {
        address: REWARD_DISTRIBUTOR,
        abi: rewardAbi,
        functionName: "claimed",
        args: [address, token.address, currentWeek],
      },
      {
        address: REWARD_DISTRIBUTOR,
        abi: rewardAbi,
        functionName: "claimable",
        args: [address, token.address, currentWeek],
      },
    ]);
  }, [address, currentWeek]);

  const {
    data: reads,
    isLoading,
    refetch,
  } = useReadContracts({
    contracts,
    query: {
      enabled: contracts.length > 0,
      refetchInterval: 30_000,
    },
  });

  const { writeContract, data: txHash, isPending, error } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
    query: {
      enabled: Boolean(txHash),
    },
  });

  const rows = useMemo(() => {
    if (!reads || reads.length === 0) return [];

    return TOKENS.map((token, i) => {
      const base = i * 12;
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
        allocation: reads[base + 9]?.result,
        claimed: reads[base + 10]?.result,
        claimable: reads[base + 11]?.result,
      };
    });
  }, [reads]);

  async function onClaim(token) {
    if (currentWeek === undefined) return;

    writeContract({
      address: REWARD_DISTRIBUTOR,
      abi: rewardAbi,
      functionName: "claim",
      args: [token.address, currentWeek],
    });
  }

  async function refreshAll() {
    await Promise.allSettled([refetchWeek(), refetch()]);
  }

  return (
    <section className="reward-panel">
      <div className="reward-panel__header">
        <div>
          <p className="eyebrow">Private rewards</p>
          <h2>Reward Panel</h2>
          <p className="muted">
            Live reward status from FeeTreasury and RewardDistributor. Admin actions stay CLI-only.
          </p>
        </div>

        <button className="secondary-button" type="button" onClick={refreshAll}>
          Refresh
        </button>
      </div>

      <div className="reward-summary">
        <div>
          <span>Current week</span>
          <strong>{weekLoading ? "Loading…" : String(currentWeek ?? "—")}</strong>
        </div>
        <div>
          <span>Connected wallet</span>
          <strong>{isConnected ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Not connected"}</strong>
        </div>
        <div>
          <span>Reward contract</span>
          <strong>{`${REWARD_DISTRIBUTOR.slice(0, 6)}…${REWARD_DISTRIBUTOR.slice(-4)}`}</strong>
        </div>
      </div>

      <div className="reward-table-wrap">
        <table className="reward-table">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Status</th>
              <th>Treasury rewards</th>
              <th>Threshold</th>
              <th>Reward balance</th>
              <th>Week funded</th>
              <th>Week claimed</th>
              <th>Your claimable</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan="9">Loading reward state…</td>
              </tr>
            )}

            {!isLoading &&
              rows.map((row) => {
                const canClaim = isConnected && isPositive(row.claimable) && !isPending && !isConfirming;

                return (
                  <tr key={row.symbol}>
                    <td>
                      <strong>{row.symbol}</strong>
                    </td>
                    <td>
                      <span className={row.enabled ? "pill pill--ok" : "pill"}>
                        {row.enabled ? "enabled" : "inactive"}
                      </span>
                      {row.canDistribute ? (
                        <span className="pill pill--soft">distributable</span>
                      ) : (
                        <span className="pill">below threshold</span>
                      )}
                    </td>
                    <td>{fmt(row.treasuryRewards, row.decimals)}</td>
                    <td>{fmt(row.threshold, row.decimals)}</td>
                    <td>{fmt(row.rewardBalance, row.decimals)}</td>
                    <td>{fmt(row.weekFunded, row.decimals)}</td>
                    <td>{fmt(row.weekClaimed, row.decimals)}</td>
                    <td>
                      <strong>{fmt(row.claimable, row.decimals)}</strong>
                    </td>
                    <td>
                      <button
                        className="primary-button"
                        type="button"
                        disabled={!canClaim}
                        onClick={() => onClaim(row)}
                      >
                        {isPending || isConfirming ? "Claiming…" : "Claim"}
                      </button>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {isSuccess && <p className="success-text">Claim transaction confirmed.</p>}
      {error && <p className="error-text">{error.shortMessage || error.message}</p>}

      <p className="muted small">
        Operator-only actions such as funding weeks, setting allocation, changing thresholds, and treasury withdrawals
        are intentionally not exposed here.
      </p>
    </section>
  );
}
