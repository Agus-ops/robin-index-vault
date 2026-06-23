import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import "dotenv/config";

const RPC = process.env.ROBIN_RPC;
const PK = process.env.PRIVATE_KEY;
const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(PK, provider);
const deployer = wallet.address;

function art(contractPath) {
  // contractPath contoh: "ReceiptToken.sol/ReceiptToken"
  return JSON.parse(fs.readFileSync(path.join("artifacts", "contracts", `${contractPath}.json`), "utf8"));
}

async function deploy(label, contractPath, args = [], waitSec = 3) {
  const artifact = art(contractPath);
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log(`${label} deployed to: ${addr}`);
  if (waitSec > 0) await new Promise(r => setTimeout(r, waitSec * 1000));
  return { contract, addr };
}

async function main() {
  console.log("=== Deploy All v0.8.x Contracts ===\n");
  console.log("Deployer:", deployer);
  console.log("");

  // 1. ReceiptToken
  const { addr: receipt } = await deploy("ReceiptToken", "ReceiptToken_v0.8.1.sol/ReceiptToken", ["Robin Index Receipt", "rINDEX", deployer]);
  
  // 2. FeeTreasury
  const { addr: treasury } = await deploy("FeeTreasury", "FeeTreasury_v0.8.1.sol/FeeTreasury", [deployer]);
  
  // 3. MockStockOracle
  const { addr: oracle } = await deploy("MockStockOracle", "MockStockOracle_v0.8.1.sol/MockStockOracle", [deployer, 86400, 2]);
  
  // 4. RobinIndexVault
  const { addr: vault } = await deploy("RobinIndexVault", "RobinIndexVault_v0.8.0.sol/RobinIndexVault", [oracle, receipt, treasury]);
  
  // 5. RewardDistributor
  const { addr: distributor } = await deploy("RewardDistributor", "RewardDistributor_v0.8.1.sol/RewardDistributor", [treasury]);
  
  // 6. StockRouter
  const { addr: router } = await deploy("StockRouter", "StockRouter_v0.8.1.sol/StockRouter", [oracle, treasury]);
  
  // 7. RobinMultisig
  const MULTISIG_OWNERS = [deployer];
  const { addr: multisig } = await deploy("RobinMultisig", "RobinMultisig_v0.8.3.sol/RobinMultisig", [MULTISIG_OWNERS, 1]);

  console.log("\n=== Deployment Summary ===");
  console.log(`RECEIPT=${receipt}`);
  console.log(`TREASURY=${treasury}`);
  console.log(`ORACLE=${oracle}`);
  console.log(`VAULT=${vault}`);
  console.log(`DISTRIBUTOR=${distributor}`);
  console.log(`ROUTER=${router}`);
  console.log(`MULTISIG=${multisig}`);

  // Simpan ke file
  const out = {
    chainId: 46630,
    deployer,
    timestamp: new Date().toISOString(),
    contracts: {
      receipt,
      treasury,
      oracle,
      vault,
      rewardDistributor: distributor,
      router,
      multisig,
    }
  };
  fs.writeFileSync("deploy-v08-output.json", JSON.stringify(out, null, 2));
  console.log("\nSaved to deploy-v08-output.json");
}

main().catch(console.error);
