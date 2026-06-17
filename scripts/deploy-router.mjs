import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import "dotenv/config";

const RPC = process.env.ROBIN_RPC;
const PK = process.env.PRIVATE_KEY;
const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(PK, provider);

const artifact = JSON.parse(
  fs.readFileSync(path.join("artifacts", "contracts", "StockRouter.sol", "StockRouter.json"), "utf8")
);

const ORACLE = "0xC1c84d45DB3CD10e300CCc84F6900995c2260d1A";   // MockStockOracle
const TREASURY = "0x05FbC935652605B697522B3f0bd4c14FfBAb8209"; // FeeTreasury

async function main() {
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const contract = await factory.deploy(ORACLE, TREASURY);
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log("StockRouter deployed to:", addr);
}
main().catch(console.error);
