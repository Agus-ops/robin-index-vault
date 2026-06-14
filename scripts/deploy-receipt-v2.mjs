import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import "dotenv/config";

const RPC = process.env.ROBIN_RPC;
const PK = process.env.PRIVATE_KEY;
const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(PK, provider);

const artifact = JSON.parse(
  fs.readFileSync(path.join("artifacts", "ReceiptToken.json"), "utf8")
);

const VAULT = "0xD39a604Ddc92115C5cB0F70fc85AC5581D9e81A7";
const NAME = "Robin Index Receipt";
const SYMBOL = "rINDEX";

async function main() {
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const contract = await factory.deploy(NAME, SYMBOL, wallet.address);
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log("ReceiptToken deployed to:", addr);

  // Set vault
  const tx = await contract.setVault(VAULT);
  await tx.wait();
  console.log("Vault set to:", VAULT);

  // Lock vault
  const tx2 = await contract.lockVault();
  await tx2.wait();
  console.log("Vault locked");
}
main().catch(console.error);
