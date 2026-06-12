import fs from "fs";
import path from "path";
import "dotenv/config";
import { ethers } from "ethers";

const ROOT = process.cwd();
const DEPLOY = JSON.parse(
  fs.readFileSync(path.join(ROOT, "deployments/robinhood-46630.json"), "utf8")
);

function artifact(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "artifacts", `${name}.json`), "utf8"));
}

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)"
];

async function waitTx(label, tx) {
  console.log(`TX ${label}: ${tx.hash}`);
  const rc = await tx.wait();
  console.log(`✅ ${label} mined block=${rc.blockNumber} gas=${rc.gasUsed}`);
  return rc;
}

async function expectStaticRevert(label, fn) {
  try {
    await fn();
    console.log(`❌ ${label}: expected revert, but staticCall succeeded`);
    return false;
  } catch (e) {
    const msg = e.shortMessage || e.message || String(e);
    console.log(`✅ ${label}: reverted as expected`);
    console.log(`   reason: ${msg.slice(0, 180)}`);
    return true;
  }
}

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.ROBIN_RPC);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const vault = new ethers.Contract(
    DEPLOY.contracts.vault,
    artifact("RobinIndexVault").abi,
    wallet
  );

  const treasury = new ethers.Contract(
    DEPLOY.contracts.treasury,
    artifact("FeeTreasury").abi,
    wallet
  );

  const AMZN = ethers.getAddress(DEPLOY.tokens.AMZN.address);
  const token = new ethers.Contract(AMZN, ERC20_ABI, wallet);

  console.log("Wallet  :", wallet.address);
  console.log("Vault   :", DEPLOY.contracts.vault);
  console.log("Treasury:", DEPLOY.contracts.treasury);
  console.log("Token   : AMZN", AMZN);
  console.log();

  let failures = 0;

  if (await vault.paused()) {
    console.log("Vault is paused at start, unpausing first...");
    await waitTx("Vault.unpause()", await vault.unpause());
  }

  if (await treasury.paused()) {
    console.log("Treasury is paused at start, unpausing first...");
    await waitTx("Treasury.unpause()", await treasury.unpause());
  }

  const vaultActual = await token.balanceOf(DEPLOY.contracts.vault);
  const vaultDeposits = await vault.totalTokenDeposits(AMZN);
  const vaultPending = await vault.pendingFees(AMZN);
  const treasuryActualBefore = await token.balanceOf(DEPLOY.contracts.treasury);
  const treasuryAccountedBefore = await treasury.accountedBalance(AMZN);
  const walletTokenBefore = await token.balanceOf(wallet.address);

  console.log("Before:");
  console.log("wallet AMZN          :", ethers.formatUnits(walletTokenBefore, 18));
  console.log("vault actual         :", ethers.formatUnits(vaultActual, 18));
  console.log("vault totalDeposits  :", ethers.formatUnits(vaultDeposits, 18));
  console.log("vault pendingFees    :", ethers.formatUnits(vaultPending, 18));
  console.log("treasury actual      :", ethers.formatUnits(treasuryActualBefore, 18));
  console.log("treasury accounted   :", ethers.formatUnits(treasuryAccountedBefore, 18));
  console.log();

  if (vaultActual < vaultDeposits + vaultPending) {
    throw new Error("Vault balance is already below accounted amount; aborting");
  }

  if (treasuryActualBefore < treasuryAccountedBefore) {
    throw new Error("Treasury balance is already below accounted amount; aborting");
  }

  const okVaultSupportedRecover = await expectStaticRevert(
    "Vault.recoverUnsupportedToken(AMZN supported token)",
    async () => vault.recoverUnsupportedToken.staticCall(
      AMZN,
      wallet.address,
      1n
    )
  );

  if (!okVaultSupportedRecover) failures++;

  const surplusBefore = treasuryActualBefore - treasuryAccountedBefore;
  console.log();
  console.log("Treasury surplus before direct transfer:", surplusBefore.toString(), "wei");

  if (surplusBefore === 0n) {
    const okNoSurplusRecover = await expectStaticRevert(
      "Treasury.recoverUnaccountedToken(AMZN, 1 wei) with zero surplus",
      async () => treasury.recoverUnaccountedToken.staticCall(
        AMZN,
        wallet.address,
        1n
      )
    );

    if (!okNoSurplusRecover) failures++;
  } else {
    console.log("⚠️ Treasury already has surplus, skipping zero-surplus revert check");
  }

  if (walletTokenBefore < 1n) {
    throw new Error("Need at least 1 wei AMZN in wallet for surplus recovery test");
  }

  console.log();
  console.log("Creating direct 1 wei AMZN surplus in Treasury...");
  await waitTx("AMZN.transfer(Treasury, 1 wei)", await token.transfer(DEPLOY.contracts.treasury, 1n));

  const treasuryActualAfterGift = await token.balanceOf(DEPLOY.contracts.treasury);
  const treasuryAccountedAfterGift = await treasury.accountedBalance(AMZN);
  const surplusAfterGift = treasuryActualAfterGift - treasuryAccountedAfterGift;

  console.log("Treasury actual after direct transfer   :", treasuryActualAfterGift.toString(), "wei");
  console.log("Treasury accounted after direct transfer:", treasuryAccountedAfterGift.toString(), "wei");
  console.log("Treasury surplus after direct transfer  :", surplusAfterGift.toString(), "wei");

  if (surplusAfterGift < 1n) {
    throw new Error("Direct surplus was not created");
  }

  await waitTx(
    "Treasury.recoverUnaccountedToken(AMZN, 1 wei)",
    await treasury.recoverUnaccountedToken(AMZN, wallet.address, 1n)
  );

  const treasuryActualFinal = await token.balanceOf(DEPLOY.contracts.treasury);
  const treasuryAccountedFinal = await treasury.accountedBalance(AMZN);
  const walletTokenFinal = await token.balanceOf(wallet.address);

  console.log();
  console.log("After recovery:");
  console.log("wallet AMZN          :", ethers.formatUnits(walletTokenFinal, 18));
  console.log("treasury actual      :", ethers.formatUnits(treasuryActualFinal, 18));
  console.log("treasury accounted   :", ethers.formatUnits(treasuryAccountedFinal, 18));
  console.log("treasury surplus     :", (treasuryActualFinal - treasuryAccountedFinal).toString(), "wei");

  if (treasuryAccountedFinal !== treasuryAccountedBefore) {
    console.log("❌ Treasury accounted changed during surplus recovery");
    failures++;
  } else {
    console.log("✅ Treasury accounted balance unchanged");
  }

  if (treasuryActualFinal !== treasuryActualBefore) {
    console.log("❌ Treasury actual balance did not return to original after surplus recovery");
    failures++;
  } else {
    console.log("✅ Treasury actual balance returned to original");
  }

  if (failures > 0) {
    throw new Error(`Recovery guard test finished with ${failures} failure(s)`);
  }

  console.log();
  console.log("✅ Recovery guard test passed");
  console.log("✅ vault cannot recover supported token");
  console.log("✅ treasury cannot recover accounted balance");
  console.log("✅ treasury can recover direct unaccounted surplus only");
}

main().catch((err) => {
  console.error();
  console.error("❌ Recovery guard test failed:");
  console.error(err.shortMessage || err.message || err);
  process.exit(1);
});
