import { loadArtifact } from "./lib/artifact-loader.mjs";
import fs from "fs";
import path from "path";
import "dotenv/config";
import { ethers } from "ethers";

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
    await fn();
    console.log(`❌ ${label}: expected revert, but tx succeeded`);
  } catch (e) {
    const msg = e.shortMessage || e.message || String(e);
    console.log(`✅ ${label}: reverted as expected`);
    console.log(`   reason: ${msg.slice(0, 180)}`);
  }
}

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
];

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

  const TSLA = ethers.getAddress(DEPLOY.tokens.TSLA.address);
  const tsla = new ethers.Contract(TSLA, ERC20_ABI, wallet);
  const dec = await tsla.decimals();

  const tinyDeposit = ethers.parseUnits("0.01", dec);
  const tinyWithdraw = ethers.parseUnits("0.01", dec);

  console.log("Wallet:", wallet.address);
  console.log("Vault :", DEPLOY.contracts.vault);
  console.log("TSLA  :", TSLA);
  console.log();

  const beforeBal = await vault.userBalances(wallet.address, TSLA);
  const beforeR = await receipt.balanceOf(wallet.address);

  console.log("Before:");
  console.log("vault user TSLA:", ethers.formatUnits(beforeBal, dec));
  console.log("rINDEX         :", ethers.formatUnits(beforeR, 18));
  console.log("paused         :", await vault.paused());
  console.log();

  if (beforeBal < tinyWithdraw) {
    throw new Error("Need at least 0.01 vault TSLA balance from smoke test");
  }

  if (!(await vault.paused())) {
    await waitTx("Vault.pause()", await vault.pause());
  }

  console.log("paused now:", await vault.paused());
  console.log();

  const allowance = await tsla.allowance(wallet.address, DEPLOY.contracts.vault);
  if (allowance < tinyDeposit) {
    await waitTx("Approve tiny TSLA", await tsla.approve(DEPLOY.contracts.vault, tinyDeposit));
  }

  await expectRevert(
    "deposit while paused",
    async () => {
      const tx = await vault.deposit(TSLA, tinyDeposit);
      await tx.wait();
    }
  );

  await waitTx(
    "withdraw while paused",
    await vault.withdraw(TSLA, tinyWithdraw)
  );

  const afterBal = await vault.userBalances(wallet.address, TSLA);
  const afterR = await receipt.balanceOf(wallet.address);

  console.log();
  console.log("After paused withdraw:");
  console.log("vault user TSLA:", ethers.formatUnits(afterBal, dec));
  console.log("rINDEX         :", ethers.formatUnits(afterR, 18));
  console.log("paused         :", await vault.paused());

  await waitTx("Vault.unpause()", await vault.unpause());

  console.log();
  console.log("Final paused:", await vault.paused());
  console.log("✅ Pause/withdraw test complete");
}

main().catch((err) => {
  console.error("\n❌ Test failed:");
  console.error(err);
  process.exit(1);
});
