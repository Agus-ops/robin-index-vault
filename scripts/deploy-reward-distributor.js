import fs from "fs";
import path from "path";
import "dotenv/config";
import { ethers } from "ethers";

const ROOT = process.cwd();
const DEPLOY_PATH = path.join(ROOT, "deployments/robinhood-46630.json");

const DEPLOY = JSON.parse(fs.readFileSync(DEPLOY_PATH, "utf8"));
const ARTIFACT = JSON.parse(
  fs.readFileSync(path.join(ROOT, "artifacts/RewardDistributor.json"), "utf8")
);

const provider = new ethers.JsonRpcProvider(process.env.ROBIN_RPC);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const treasury =
  DEPLOY.contracts.feeTreasury ||
  DEPLOY.contracts.treasury ||
  DEPLOY.contracts.FeeTreasury;

if (!treasury) {
  throw new Error("FeeTreasury address not found in deployments file");
}

console.log("Deployer :", wallet.address);
console.log("Treasury :", treasury);
console.log("Network  :", (await provider.getNetwork()).chainId.toString());

const Factory = new ethers.ContractFactory(
  ARTIFACT.abi,
  ARTIFACT.bytecode,
  wallet
);

const distributor = await Factory.deploy(treasury);
console.log("Deploy tx:", distributor.deploymentTransaction().hash);

await distributor.waitForDeployment();

const address = await distributor.getAddress();
console.log("RewardDistributor:", address);

const code = await provider.getCode(address);
if (code === "0x") {
  throw new Error("RewardDistributor deploy failed: no code at address");
}

DEPLOY.contracts.rewardDistributor = address;
DEPLOY.transactions ??= {};
DEPLOY.transactions.rewardDistributorDeploy = distributor.deploymentTransaction().hash;

fs.writeFileSync(DEPLOY_PATH, JSON.stringify(DEPLOY, null, 2) + "\n");

console.log("✅ Deployment saved to", DEPLOY_PATH);
