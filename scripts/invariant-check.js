import fs from "fs";
import path from "path";
import "dotenv/config";
import { ethers } from "ethers";

const ROOT = process.cwd();
const DEPLOY = JSON.parse(
  fs.readFileSync(path.join(ROOT, "deployments/robinhood-46630.json"), "utf8")
);

function artifact(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "artifacts", name + ".json"), "utf8"));
}

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)"
];

function fmt(v, d) {
  return ethers.formatUnits(v, d);
}

function line() {
  console.log("------------------------------------------------------------");
}

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.ROBIN_RPC);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  if (chainId !== 46630) throw new Error("Wrong chainId " + chainId);

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

  const treasury = new ethers.Contract(
    DEPLOY.contracts.treasury,
    artifact("FeeTreasury").abi,
    wallet
  );

  const oracle = new ethers.Contract(
    DEPLOY.contracts.oracle,
    artifact("MockStockOracle").abi,
    wallet
  );

  const defaultUsers = process.env.OWNER || wallet.address;
  const users = (process.env.WATCH_USERS || defaultUsers)
    .split(",")
    .map(x => x.trim())
    .filter(Boolean)
    .map(x => ethers.getAddress(x));

  const expectOnlyWatchedUsers = process.env.EXPECT_ONLY_WATCH_USERS !== "0";

  let fails = 0;
  let warns = 0;
  let passes = 0;

  function pass(msg) {
    passes++;
    console.log("✅ PASS:", msg);
  }

  function warn(msg) {
    warns++;
    console.log("⚠️ WARN:", msg);
  }

  function fail(msg) {
    fails++;
    console.log("❌ FAIL:", msg);
  }

  console.log("Robin Index Vault invariant check");
  console.log("Chain ID :", chainId);
  console.log("Wallet   :", wallet.address);
  console.log("Users    :", users.join(", "));
  console.log();

  line();
  console.log("Core contract wiring");
  line();

  const receiptVault = await receipt.vault();
  const vaultLocked = await receipt.vaultLocked();
  const treasurySource = await treasury.allowedFeeSources(DEPLOY.contracts.vault);

  if (receiptVault.toLowerCase() === DEPLOY.contracts.vault.toLowerCase()) {
    pass("ReceiptToken.vault matches RobinIndexVault");
  } else {
    fail("ReceiptToken.vault mismatch: " + receiptVault);
  }

  if (vaultLocked) {
    pass("ReceiptToken vault is locked");
  } else {
    fail("ReceiptToken vault is not locked");
  }

  if (treasurySource) {
    pass("Vault is allowed FeeTreasury fee source");
  } else {
    fail("Vault is not allowed FeeTreasury fee source");
  }

  const vaultPaused = await vault.paused();
  const treasuryPaused = await treasury.paused();

  if (!vaultPaused) pass("Vault is not paused");
  else warn("Vault is paused");

  if (!treasuryPaused) pass("Treasury is not paused");
  else warn("Treasury is paused");

  const priceDecimals = Number(await oracle.PRICE_DECIMALS());
  if (priceDecimals <= 18) {
    pass("Oracle PRICE_DECIMALS <= 18");
  } else {
    fail("Oracle PRICE_DECIMALS > 18");
  }

  line();
  console.log("Per-token accounting");
  line();

  const tokenList = Object.entries(DEPLOY.tokens);

  for (const [symbol, cfg] of tokenList) {
    const tokenAddr = ethers.getAddress(cfg.address);
    const token = new ethers.Contract(tokenAddr, ERC20_ABI, wallet);

    let ercSymbol = symbol;
    let dec = cfg.decimals;

    try {
      ercSymbol = await token.symbol();
      dec = Number(await token.decimals());
    } catch {}

    const tokenConfig = await vault.tokenConfigs(tokenAddr);
    const supported = Boolean(tokenConfig[0]);
    const isStock = Boolean(tokenConfig[1]);
    const isSettlement = Boolean(tokenConfig[2]);
    const configuredDecimals = Number(tokenConfig[3]);

    const vaultActual = await token.balanceOf(DEPLOY.contracts.vault);
    const totalDeposits = await vault.totalTokenDeposits(tokenAddr);
    const pendingFees = await vault.pendingFees(tokenAddr);
    const vaultAccounted = totalDeposits + pendingFees;

    const treasuryActual = await token.balanceOf(DEPLOY.contracts.treasury);
    const treasuryAccounted = await treasury.accountedBalance(tokenAddr);

    const priceData = await oracle.getPriceData(tokenAddr);
    const price = priceData[0];
    const oracleSupported = Boolean(priceData[2]);
    const fresh = await oracle.isFresh(tokenAddr);

    console.log();
    console.log(symbol + " (" + ercSymbol + ")");
    console.log("token:", tokenAddr);
    console.log("decimals:", dec);
    console.log("vault actual:", fmt(vaultActual, dec));
    console.log("vault accounted:", fmt(vaultAccounted, dec));
    console.log("treasury actual:", fmt(treasuryActual, dec));
    console.log("treasury accounted:", fmt(treasuryAccounted, dec));
    console.log("oracle price8:", price.toString(), "fresh:", fresh);

    if (supported) pass(symbol + " supported in vault");
    else fail(symbol + " not supported in vault");

    if (configuredDecimals === dec) pass(symbol + " configured decimals match ERC20 decimals");
    else fail(symbol + " decimals mismatch config=" + configuredDecimals + " erc20=" + dec);

    if (cfg.isStock === isStock) pass(symbol + " stock flag matches deployment config");
    else fail(symbol + " stock flag mismatch");

    if (cfg.isSettlement === isSettlement) pass(symbol + " settlement flag matches deployment config");
    else fail(symbol + " settlement flag mismatch");

    if (oracleSupported) pass(symbol + " supported in oracle");
    else fail(symbol + " not supported in oracle");

    if (price > 0n) pass(symbol + " oracle price is non-zero");
    else fail(symbol + " oracle price is zero");

    if (fresh) pass(symbol + " oracle price is fresh");
    else warn(symbol + " oracle price is stale");

    if (vaultActual >= vaultAccounted) {
      pass(symbol + " vault actual balance covers accounted balance");
      if (vaultActual > vaultAccounted) {
        warn(symbol + " vault has unaccounted surplus " + fmt(vaultActual - vaultAccounted, dec));
      }
    } else {
      fail(symbol + " vault actual balance is below accounted balance");
    }

    if (treasuryActual >= treasuryAccounted) {
      pass(symbol + " treasury actual balance covers bucket accounting");
      if (treasuryActual > treasuryAccounted) {
        warn(symbol + " treasury has unaccounted surplus " + fmt(treasuryActual - treasuryAccounted, dec));
      }
    } else {
      fail(symbol + " treasury actual balance is below bucket accounting");
    }
  }

  line();
  console.log("Watched user receipt and NAV checks");
  line();

  let watchedReceiptSum = 0n;

  for (const user of users) {
    let userReceiptByTokenSum = 0n;
    let computedPortfolioUsd18 = 0n;

    console.log();
    console.log("User:", user);

    for (const [symbol, cfg] of tokenList) {
      const tokenAddr = ethers.getAddress(cfg.address);
      const dec = Number(cfg.decimals);

      const bal = await vault.userBalances(user, tokenAddr);
      const receiptForToken = await vault.userReceiptByToken(user, tokenAddr);

      userReceiptByTokenSum += receiptForToken;

      const priceData = await oracle.getPriceData(tokenAddr);
      const price = priceData[0];

      if (bal > 0n && price > 0n) {
        const priceScale = 10n ** BigInt(18 - priceDecimals);
        const tokenScale = 10n ** BigInt(dec);
        computedPortfolioUsd18 += (bal * price * priceScale) / tokenScale;
      }

      if (bal > 0n || receiptForToken > 0n) {
        console.log(
          symbol,
          "vaultBal=" + fmt(bal, dec),
          "receipt=" + fmt(receiptForToken, 18)
        );
      }
    }

    const receiptBalance = await receipt.balanceOf(user);
    const portfolioView = await vault.getUserPortfolioValueUsd(user);

    watchedReceiptSum += userReceiptByTokenSum;

    console.log("receipt.balanceOf:", fmt(receiptBalance, 18));
    console.log("sum receiptByToken:", fmt(userReceiptByTokenSum, 18));
    console.log("computed NAV USD :", fmt(computedPortfolioUsd18, 18));
    console.log("vault NAV USD    :", fmt(portfolioView[0], 18));
    console.log("all prices fresh :", portfolioView[1]);

    if (receiptBalance === userReceiptByTokenSum) {
      pass("User rINDEX balance equals sum userReceiptByToken");
    } else {
      fail("User rINDEX balance does not equal sum userReceiptByToken");
    }

    if (portfolioView[0] === computedPortfolioUsd18) {
      pass("User portfolio NAV matches CLI calculation");
    } else {
      fail("User portfolio NAV mismatch");
    }
  }

  const totalSupply = await receipt.totalSupply();

  console.log();
  console.log("Receipt totalSupply:", fmt(totalSupply, 18));
  console.log("Watched receipt sum:", fmt(watchedReceiptSum, 18));

  if (expectOnlyWatchedUsers) {
    if (totalSupply === watchedReceiptSum) {
      pass("Receipt totalSupply equals watched user receipts");
    } else {
      fail("Receipt totalSupply differs from watched receipts. Set EXPECT_ONLY_WATCH_USERS=0 if other users exist.");
    }
  } else {
    if (totalSupply >= watchedReceiptSum) {
      pass("Receipt totalSupply covers watched user receipts");
    } else {
      fail("Receipt totalSupply below watched receipts");
    }
  }

  line();
  console.log("Summary");
  line();

  console.log("Passes:", passes);
  console.log("Warnings:", warns);
  console.log("Failures:", fails);

  if (fails > 0) {
    console.log();
    console.log("❌ Invariant check failed");
    process.exit(1);
  }

  console.log();
  console.log("✅ Invariant check passed");
}

main().catch((err) => {
  console.error();
  console.error("❌ Invariant script crashed:");
  console.error(err.shortMessage || err.message || err);
  process.exit(1);
});
