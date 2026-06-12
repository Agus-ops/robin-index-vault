import fs from "fs";
import path from "path";
import { ethers } from "ethers";
import { TOKENS, INITIAL_PRICES_8 } from "./tokens.js";

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

const ROOT = process.cwd();
const ARTIFACTS_DIR = path.join(ROOT, "artifacts");
const DEPLOYMENTS_DIR = path.join(ROOT, "deployments");

function mustEnv(name) {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error("Missing env " + name);
  return v.trim();
}

function loadArtifact(name) {
  const p = path.join(ARTIFACTS_DIR, name + ".json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function bytecodeOf(artifact) {
  return artifact.bytecode.startsWith("0x") ? artifact.bytecode : "0x" + artifact.bytecode;
}

async function waitTx(label, tx) {
  console.log("  tx " + label + ":", tx.hash);
  const rc = await tx.wait();
  console.log("  ✅ " + label + " mined block=" + rc.blockNumber + " gas=" + rc.gasUsed);
  return rc;
}

async function deployContract(name, args, wallet, txs) {
  const artifact = loadArtifact(name);
  const factory = new ethers.ContractFactory(artifact.abi, bytecodeOf(artifact), wallet);

  console.log("\nDeploying " + name + "...");
  const c = await factory.deploy(...args);
  const tx = c.deploymentTransaction();

  console.log("  tx deploy:", tx.hash);
  await c.waitForDeployment();

  const addr = await c.getAddress();
  console.log("  ✅ " + name + ":", addr);

  txs[name + "Deploy"] = tx.hash;

  return c;
}

async function main() {
  const rpc = mustEnv("ROBIN_RPC");
  const pk = mustEnv("PRIVATE_KEY");

  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(pk, provider);

  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);

  if (chainId !== 46630) {
    throw new Error("Wrong chainId " + chainId + ", expected Robinhood Testnet 46630");
  }

  const owner = process.env.OWNER && process.env.OWNER.trim()
    ? ethers.getAddress(process.env.OWNER.trim())
    : wallet.address;

  const bal = await provider.getBalance(wallet.address);

  console.log("Robin Index Vault v0.2.0 full verified deploy");
  console.log("Network chainId:", chainId);
  console.log("Deployer       :", wallet.address);
  console.log("Owner          :", owner);
  console.log("Native balance :", ethers.formatEther(bal));

  fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });

  const txs = {};

  const oracle = await deployContract("MockStockOracle", [owner, 24 * 60 * 60], wallet, txs);
  const receipt = await deployContract("ReceiptToken", ["Robin Index Receipt", "rINDEX", owner], wallet, txs);
  const treasury = await deployContract("FeeTreasury", [owner], wallet, txs);

  const vault = await deployContract(
    "RobinIndexVault",
    [owner, await oracle.getAddress(), await receipt.getAddress(), await treasury.getAddress()],
    wallet,
    txs
  );

  const rewardDistributor = await deployContract(
    "RewardDistributor",
    [await treasury.getAddress()],
    wallet,
    txs
  );

  console.log("\nPost-deploy configuration...");

  await waitTx(
    "ReceiptToken.setVault(vault)",
    await receipt.setVault(await vault.getAddress())
  );

  await waitTx(
    "FeeTreasury.setFeeSource(vault,true)",
    await treasury.setFeeSource(await vault.getAddress(), true)
  );

  await waitTx(
    "FeeTreasury.setRewardDistributor(rewardDistributor)",
    await treasury.setRewardDistributor(await rewardDistributor.getAddress())
  );

  for (const [symbol, cfg] of Object.entries(TOKENS)) {
    const token = ethers.getAddress(cfg.address);

    await waitTx(
      "Oracle.setSupportedToken(" + symbol + ",true)",
      await oracle.setSupportedToken(token, true)
    );

    await waitTx(
      "Vault.configureToken(" + symbol + ")",
      await vault.configureToken(
        token,
        true,
        cfg.isStock,
        cfg.isSettlement,
        cfg.decimals
      )
    );
  }

  const priceTokens = [];
  const prices = [];

  for (const [symbol, cfg] of Object.entries(TOKENS)) {
    if (INITIAL_PRICES_8[symbol] === undefined) continue;

    priceTokens.push(ethers.getAddress(cfg.address));
    prices.push(INITIAL_PRICES_8[symbol]);
  }

  await waitTx(
    "Oracle.setPrices(initial)",
    await oracle.setPrices(priceTokens, prices)
  );

  for (const [symbol, cfg] of Object.entries(TOKENS)) {
    const token = ethers.getAddress(cfg.address);

    let threshold;
    if (cfg.isStock) {
      threshold = ethers.parseUnits("0.5", cfg.decimals);
    } else if (symbol === "USDG") {
      threshold = ethers.parseUnits("10", cfg.decimals);
    } else {
      threshold = 0n;
    }

    await waitTx(
      "Treasury.setDistributionThreshold(" + symbol + ")",
      await treasury.setDistributionThreshold(token, threshold)
    );
  }

  const currentVault = await receipt.vault();
  if (currentVault.toLowerCase() !== (await vault.getAddress()).toLowerCase()) {
    throw new Error("ReceiptToken.vault mismatch before lock");
  }

  await waitTx(
    "ReceiptToken.lockVault()",
    await receipt.lockVault()
  );

  const rdIsKeeper = await treasury.keepers(await rewardDistributor.getAddress());
  console.log("\nRewardDistributor keeper?:", rdIsKeeper);

  const deployment = {
    version: "v0.2.0",
    chainId,
    deployer: wallet.address,
    owner,
    deployedAt: new Date().toISOString(),
    compiler: "v0.8.34+commit.80d5c536",
    contracts: {
      oracle: await oracle.getAddress(),
      receiptToken: await receipt.getAddress(),
      treasury: await treasury.getAddress(),
      vault: await vault.getAddress(),
      rewardDistributor: await rewardDistributor.getAddress()
    },
    tokens: TOKENS,
    initialPrices8: Object.fromEntries(
      Object.entries(INITIAL_PRICES_8).map(([k, v]) => [k, v.toString()])
    ),
    transactions: txs
  };

  const outPath = path.join(DEPLOYMENTS_DIR, "robinhood-" + chainId + ".json");
  fs.writeFileSync(outPath, JSON.stringify(deployment, null, 2) + "\n");

  console.log("\n✅ v0.2.0 deployment complete");
  console.log("Saved:", outPath);
  console.log("\nContracts:");
  console.log("Oracle           :", deployment.contracts.oracle);
  console.log("ReceiptToken     :", deployment.contracts.receiptToken);
  console.log("Treasury         :", deployment.contracts.treasury);
  console.log("Vault            :", deployment.contracts.vault);
  console.log("RewardDistributor:", deployment.contracts.rewardDistributor);
}

main().catch((err) => {
  console.error("\n❌ v0.2.0 deploy failed:");
  console.error(err);
  process.exit(1);
});
