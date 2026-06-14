import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import "dotenv/config";

const RPC = process.env.ROBIN_RPC;
const PK = process.env.PRIVATE_KEY;
const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(PK, provider);

function art(name) {
  return JSON.parse(fs.readFileSync(path.join("artifacts", `${name}.json`), "utf8"));
}

async function deploy(name, args = []) {
  const artifact = art(name);
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log(`${name} deployed to: ${addr}`);
  return { contract, addr };
}

async function main() {
  console.log("=== Deploy All Core Contracts ===\n");

  // 1. Oracle
  const { addr: oracle } = await deploy("MockStockOracle", [wallet.address, 86400]);
  
  // 2. ReceiptToken
  const { addr: receipt } = await deploy("ReceiptToken", ["Robin Index Receipt", "rINDEX", wallet.address]);
  
  // 3. FeeTreasury
  const { addr: treasury } = await deploy("FeeTreasury", [wallet.address]);
  
  // 4. RobinIndexVault (perlu oracle, receipt, treasury)
  const { addr: vault } = await deploy("RobinIndexVault", [wallet.address, oracle, receipt, treasury]);
  
  // 5. RewardDistributor (perlu treasury)
  const { addr: distributor } = await deploy("RewardDistributor", [treasury]);

  console.log("\n=== Wiring ===\n");

  // Wiring: ReceiptToken.setVault(vault) + lock
  const r = new ethers.Contract(receipt, art("ReceiptToken").abi, wallet);
  let tx = await r.setVault(vault);
  await tx.wait();
  tx = await r.lockVault();
  await tx.wait();
  console.log("✅ ReceiptToken: vault set + locked");

  // Wiring: FeeTreasury.setFeeSource(vault, true)
  const t = new ethers.Contract(treasury, art("FeeTreasury").abi, wallet);
  tx = await t.setFeeSource(vault, true);
  await tx.wait();
  console.log("✅ FeeTreasury: vault set as fee source");

  // Wiring: FeeTreasury.setRewardDistributor(distributor)
  tx = await t.setRewardDistributor(distributor);
  await tx.wait();
  console.log("✅ FeeTreasury: rewardDistributor set");

  // Wiring: FeeTreasury.addKeeper(wallet)
  tx = await t.addKeeper(wallet.address);
  await tx.wait();
  console.log("✅ FeeTreasury: keeper added");

  // Wiring: Vault.addKeeper(wallet)
  const v = new ethers.Contract(vault, art("RobinIndexVault").abi, wallet);
  tx = await v.addKeeper(wallet.address);
  await tx.wait();
  console.log("✅ Vault: keeper added");

  // Wiring: Oracle.setKeeper(wallet)
  const o = new ethers.Contract(oracle, art("MockStockOracle").abi, wallet);
  tx = await o.setKeeper(wallet.address, true);
  await tx.wait();
  console.log("✅ Oracle: keeper set");

  // Wiring: RewardDistributor tidak perlu jadi keeper treasury

  console.log("\n=== Deployment Summary ===");
  console.log(`ORACLE=${oracle}`);
  console.log(`RECEIPT=${receipt}`);
  console.log(`TREASURY=${treasury}`);
  console.log(`VAULT=${vault}`);
  console.log(`DISTRIBUTOR=${distributor}`);
  
  // Simpan ke file
  const out = {
    oracle, receipt, treasury, vault, rewardDistributor: distributor,
    timestamp: new Date().toISOString()
  };
  fs.writeFileSync("deploy-fresh-output.json", JSON.stringify(out, null, 2));
  console.log("\nSaved to deploy-fresh-output.json");
}

main().catch(console.error);
