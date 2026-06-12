import fs from "fs";
import path from "path";
import "dotenv/config";
import { ethers } from "ethers";
import { TOKENS, INITIAL_PRICES_8 } from "./tokens.js";

const ROOT = process.cwd();
const ARTIFACTS_DIR = path.join(ROOT, "artifacts");
const DEPLOYMENTS_DIR = path.join(ROOT, "deployments");

function loadArtifact(name) {
  const p = path.join(ARTIFACTS_DIR, `${name}.json`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function waitTx(label, tx) {
  console.log(`  tx ${label}: ${tx.hash}`);
  const rc = await tx.wait();
  console.log(`  ✅ ${label} mined in block ${rc.blockNumber}`);
  return rc;
}

async function deploy(name, args, wallet) {
  const artifact = loadArtifact(name);
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);

  console.log(`\nDeploying ${name}...`);
  const c = await factory.deploy(...args);
  console.log(`  tx deploy: ${c.deploymentTransaction().hash}`);

  await c.waitForDeployment();

  console.log(`  ✅ ${name}: ${c.target}`);
  return c;
}

function mustEnv(name) {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing env ${name}`);
  return v.trim();
}

async function main() {
  const rpc = mustEnv("ROBIN_RPC");
  const pk = mustEnv("PRIVATE_KEY");

  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(pk, provider);

  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);

  const owner = process.env.OWNER && process.env.OWNER.trim()
    ? ethers.getAddress(process.env.OWNER.trim())
    : wallet.address;

  console.log("Network chainId:", chainId);
  console.log("Deployer       :", wallet.address);
  console.log("Owner          :", owner);

  const nativeBal = await provider.getBalance(wallet.address);
  console.log("Native balance :", ethers.formatEther(nativeBal));

  if (chainId !== 46630) {
    throw new Error(`Wrong chainId ${chainId}, expected Robinhood Testnet 46630`);
  }

  fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });

  const oracle = await deploy("MockStockOracle", [owner, 24 * 60 * 60], wallet);
  const receipt = await deploy("ReceiptToken", ["Robin Index Receipt", "rINDEX", owner], wallet);
  const treasury = await deploy("FeeTreasury", [owner], wallet);

  const vault = await deploy(
    "RobinIndexVault",
    [owner, oracle.target, receipt.target, treasury.target],
    wallet
  );

  console.log("\nPost-deploy configuration...");

  await waitTx(
    "ReceiptToken.setVault(vault)",
    await receipt.setVault(vault.target)
  );

  await waitTx(
    "FeeTreasury.setFeeSource(vault,true)",
    await treasury.setFeeSource(vault.target, true)
  );

  for (const [symbol, cfg] of Object.entries(TOKENS)) {
    const token = ethers.getAddress(cfg.address);

    await waitTx(
      `Oracle.setSupportedToken(${symbol},true)`,
      await oracle.setSupportedToken(token, true)
    );

    await waitTx(
      `Vault.configureToken(${symbol})`,
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
      `Treasury.setDistributionThreshold(${symbol})`,
      await treasury.setDistributionThreshold(token, threshold)
    );
  }

  const deployment = {
    chainId,
    deployer: wallet.address,
    owner,
    deployedAt: new Date().toISOString(),
    contracts: {
      oracle: oracle.target,
      receiptToken: receipt.target,
      treasury: treasury.target,
      vault: vault.target,
    },
    tokens: TOKENS,
    initialPrices8: Object.fromEntries(
      Object.entries(INITIAL_PRICES_8).map(([k, v]) => [k, v.toString()])
    ),
  };

  const outPath = path.join(DEPLOYMENTS_DIR, `robinhood-${chainId}.json`);
  fs.writeFileSync(outPath, JSON.stringify(deployment, null, 2));

  console.log("\n✅ Deployment complete");
  console.log(`Saved: ${outPath}`);
  console.log("\nContracts:");
  console.log("Oracle      :", oracle.target);
  console.log("ReceiptToken:", receipt.target);
  console.log("Treasury    :", treasury.target);
  console.log("Vault       :", vault.target);
}

main().catch((err) => {
  console.error("\n❌ Deploy failed:");
  console.error(err);
  process.exit(1);
});
