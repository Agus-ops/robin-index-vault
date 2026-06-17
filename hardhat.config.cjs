require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.34",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  networks: {
    'robinhood-chain-testnet': {
      url: 'https://rpc.testnet.chain.robinhood.com',
    },
  },
  etherscan: {
    apiKey: {
      'robinhood-chain-testnet': 'empty'
    },
    customChains: [
      {
        network: "robinhood-chain-testnet",
        chainId: 46630,
        urls: {
          apiURL: "https://explorer.testnet.chain.robinhood.com/api",
          browserURL: "https://explorer.testnet.chain.robinhood.com"
        }
      }
    ]
  },
  paths: {
    sources: "./contracts",
    artifacts: "./artifacts",
    cache: "./cache",
  },
};
