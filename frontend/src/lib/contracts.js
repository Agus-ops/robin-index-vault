import { formatUnits } from "viem";

export const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
];

export function shortAddress(address) {
  if (!address) return "—";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatAmount(value, decimals = 18, digits = 4) {
  try {
    const n = Number(formatUnits(value || 0n, decimals));
    if (!Number.isFinite(n)) return "0";
    return n.toLocaleString(undefined, {
      maximumFractionDigits: digits,
    });
  } catch {
    return "0";
  }
}

export function formatUsd(value) {
  const n = Number(value || 0);
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

export function explorerAddress(base, address) {
  return `${base}/address/${address}`;
}

export function explorerTx(base, hash) {
  return `${base}/tx/${hash}`;
}

export function findFn(abi, names, mutability) {
  if (!Array.isArray(abi)) return null;
  return abi.find((item) => {
    if (item.type !== "function") return false;
    if (!names.includes(item.name)) return false;
    if (!mutability) return true;
    if (Array.isArray(mutability)) return mutability.includes(item.stateMutability);
    return item.stateMutability === mutability;
  });
}

export function buildVaultArgs(fn, account, tokenAddress, amount) {
  if (!fn || !Array.isArray(fn.inputs)) return null;

  const types = fn.inputs.map((x) => x.type);

  if (types.length === 2 && types[0] === "address" && types[1].startsWith("uint")) {
    return [tokenAddress, amount];
  }

  if (types.length === 3 && types[0] === "address" && types[1] === "address" && types[2].startsWith("uint")) {
    return [account, tokenAddress, amount];
  }

  if (types.length === 2 && types[0].startsWith("uint") && types[1] === "address") {
    return [amount, tokenAddress];
  }

  if (types.length === 1 && types[0].startsWith("uint")) {
    return [amount];
  }

  return null;
}

export function getFirstBigInt(result) {
  if (typeof result === "bigint") return result;
  if (Array.isArray(result)) {
    const first = result.find((x) => typeof x === "bigint");
    return first || 0n;
  }
  if (result && typeof result === "object") {
    const first = Object.values(result).find((x) => typeof x === "bigint");
    return first || 0n;
  }
  return 0n;
}
