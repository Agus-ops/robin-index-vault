import fs from "fs";
import { ethers } from "ethers";

function loadEnv(file = ".env") {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;

    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv();

const RPC = process.env.ROBIN_RPC;
const PK = process.env.PRIVATE_KEY;

if (!RPC) throw new Error("Missing ROBIN_RPC in .env");
if (!PK) throw new Error("Missing PRIVATE_KEY in .env");

const TREASURY = "0x94d6BF3eb29D15642eE10ad5d1164749eB880961";
const DEPLOY_PATH = "deployments/robinhood-46630.json";

const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(PK, provider);

const rdArtifact = JSON.parse(fs.readFileSync("artifacts/RewardDistributor.json", "utf8"));
const treasuryArtifact = JSON.parse(fs.readFileSync("artifacts/FeeTreasury.json", "utf8"));

const rdBytecode = rdArtifact.bytecode.startsWith("0x")
  ? rdArtifact.bytecode
  : "0x" + rdArtifact.bytecode;

console.log("deployer:", wallet.address);
console.log("treasury:", TREASURY);

const balance = await provider.getBalance(wallet.address);
console.log("native balance:", ethers.formatEther(balance));

const Factory = new ethers.ContractFactory(rdArtifact.abi, rdBytecode, wallet);
const rd = await Factory.deploy(TREASURY);

const deployTx = rd.deploymentTransaction();
console.log("deploy tx:", deployTx.hash);

await rd.waitForDeployment();

const rdAddr = await rd.getAddress();
console.log("RewardDistributor new:", rdAddr);

const treasury = new ethers.Contract(TREASURY, treasuryArtifact.abi, wallet);

let oldRd = null;
try {
  oldRd = await treasury.rewardDistributor();
  console.log("old rewardDistributor:", oldRd);
} catch {}

const tx = await treasury.setRewardDistributor(rdAddr);
console.log("setRewardDistributor tx:", tx.hash);
await tx.wait();

const configured = await treasury.rewardDistributor();
console.log("configured rewardDistributor:", configured);

try {
  const isKeeper = await treasury.keepers(rdAddr);
  console.log("new RD keeper?:", isKeeper);
} catch {
  console.log("keeper check skipped");
}

const dep = JSON.parse(fs.readFileSync(DEPLOY_PATH, "utf8"));

dep.previousRewardDistributor = oldRd;
dep.RewardDistributor = rdAddr;
dep.rewardDistributor = rdAddr;
dep.rewardDistributorDeployTx = deployTx.hash;
dep.rewardDistributorCompiler = "v0.8.34+commit.80d5c536";
dep.rewardDistributorRedeployedAt = new Date().toISOString();
dep.rewardDistributorSetTx = tx.hash;

fs.writeFileSync(DEPLOY_PATH, JSON.stringify(dep, null, 2) + "\n");

console.log("deployment json updated:", DEPLOY_PATH);
