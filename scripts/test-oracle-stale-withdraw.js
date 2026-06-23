import { loadArtifact } from "./lib/artifact-loader.mjs";
import fs from "fs";
import path from "path";
import "dotenv/config";
import { ethers } from "ethers";
import { TOKENS, INITIAL_PRICES_8 } from "./tokens.js";

const ROOT = process.cwd();
const DEPLOY = JSON.parse(
  fs.readFileSync(path.join(ROOT, "deployments/robinhood-46630.json"), "utf8")
);

function artifact(name) {
  return loadArtifact(ROOT, name);
}

async function waitTx(label, tx) {
  console.log(`TX ${label}: ${tx.hash}`);
  const rc = await tx.wait();
  console.log(`✅ ${label} mined block=${rc.blockNumber} gas=${rc.gasUsed}`);
  return rc;
}

async function expectRevert(label, fn) {
  try {
    const tx = await fn();
    await tx.wait();
    console.log(`❌ ${label}: expected revert, but tx succeeded`);
    return false;
  } catch (e) {
    const msg = e.shortMessage || e.message || String(e);
    console.log(`✅ ${label}: reverted as expected`);
    console.log(`   reason: ${msg.slice(0, 180)}`);
    return true;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function restoreOracle(oracle) {
  console.log();
  console.log("Restoring oracle maxStaleTime to 24h and refreshing prices...");

  const current = await oracle.maxStaleTime();
  if (current !== 86400n) {
    await waitTx("Oracle.setMaxStaleTime(24h)", await oracle.setMaxStaleTime(86400));
  }

  const tokens = [];
  const prices = [];

  for (const [symbol, cfg] of Object.entries(TOKENS)) {
    if (INITIAL_PRICES_8[symbol] === undefined) continue;
    tokens.push(ethers.getAddress(cfg.address));
    prices.push(INITIAL_PRICES_8[symbol]);
  }

  await waitTx("Oracle.setPrices(refresh)", await oracle.setPrices(tokens, prices));
}

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.ROBIN_RPC);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const vault = new ethers.Contract(
    DEPLOY.contracts.vault,
    artifact("RobinIndexVault").abi,
    wallet
  );

  const receipt = new ethers.Contract(
    DEPLOY.contracts.receiptToken,
    artifact("ReceiptToken").abi,
    wallet
  );

  const oracle = new ethers.Contract(
    DEPLOY.contracts.oracle,
    artifact("MockStockOracle").abi,
    wallet
  );

  const AMZN = ethers.getAddress(DEPLOY.tokens.AMZN.address);
  const dec = 18;

  const tinyDeposit = ethers.parseUnits("0.001", dec);
  const tinyWithdraw = ethers.parseUnits("0.001", dec);

  console.log("Wallet:", wallet.address);
  console.log("Vault :", DEPLOY.contracts.vault);
  console.log("Oracle:", DEPLOY.contracts.oracle);
  console.log("Token : AMZN", AMZN);
  console.log();

  const beforeBal = await vault.userBalances(wallet.address, AMZN);
  const beforeR = await receipt.balanceOf(wallet.address);

  console.log("Before:");
  console.log("vault AMZN:", ethers.formatUnits(beforeBal, dec));
  console.log("rINDEX    :", ethers.formatUnits(beforeR, 18));
  console.log("fresh     :", await oracle.isFresh(AMZN));
  console.log("staleTime :", (await oracle.maxStaleTime()).toString());

  if (beforeBal < tinyWithdraw) {
    throw new Error("Need at least 0.001 AMZN vault balance");
  }

  try {
    await waitTx("Oracle.setMaxStaleTime(1)", await oracle.setMaxStaleTime(1));

    console.log("Waiting 3 seconds so oracle becomes stale...");
    await sleep(3000);

    const freshAfterWait = await oracle.isFresh(AMZN);
    console.log("fresh after wait:", freshAfterWait);

    if (freshAfterWait) {
      throw new Error("Oracle is still fresh; stale test cannot continue");
    }

    await expectRevert(
      "deposit while oracle stale",
      async () => vault.deposit(AMZN, tinyDeposit)
    );

    await waitTx(
      "withdraw while oracle stale",
      await vault.withdraw(AMZN, tinyWithdraw)
    );

    const afterBal = await vault.userBalances(wallet.address, AMZN);
    const afterR = await receipt.balanceOf(wallet.address);
    const pending = await vault.pendingFees(AMZN);

    console.log();
    console.log("After stale withdraw:");
    console.log("vault AMZN  :", ethers.formatUnits(afterBal, dec));
    console.log("rINDEX      :", ethers.formatUnits(afterR, 18));
    console.log("pending AMZN:", ethers.formatUnits(pending, dec));
  } finally {
    await restoreOracle(oracle);
  }

  console.log();
  console.log("Final:");
  console.log("fresh     :", await oracle.isFresh(AMZN));
  console.log("staleTime :", (await oracle.maxStaleTime()).toString());
  console.log();
  console.log("✅ Oracle stale withdraw test complete");
}

main().catch((err) => {
  console.error();
  console.error("❌ Stale test failed:");
  console.error(err.shortMessage || err.message || err);
  process.exit(1);
});
