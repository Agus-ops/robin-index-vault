import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { defineChain, http } from "viem";

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: {
    name: "Robinhood Testnet ETH",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [import.meta.env.VITE_ROBIN_RPC || "https://rpc-url-required.invalid"],
    },
  },
  blockExplorers: {
    default: {
      name: "Robinhood Testnet Explorer",
      url: "https://explorer.testnet.chain.robinhood.com",
    },
  },
  testnet: true,
});

export const wagmiConfig = getDefaultConfig({
  appName: "Robin Index Vault",
  projectId: import.meta.env.VITE_WC_PROJECT_ID || "00000000000000000000000000000000",
  chains: [robinhoodTestnet],
  transports: {
    [robinhoodTestnet.id]: http(import.meta.env.VITE_ROBIN_RPC || undefined),
  },
});
