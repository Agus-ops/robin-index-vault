import fs from "fs";
import path from "path";
import "dotenv/config";
import { ethers } from "ethers";

const ROOT_DIR = process.cwd();
const DEPLOY = JSON.parse(
  fs.readFileSync(path.join(ROOT_DIR, "deployments/robinhood-46630.json"), "utf8")
);

function artifact(name) {
  return JSON.parse(
    fs.readFileSync(path.join(ROOT_DIR, "artifacts", "contracts", name.split("/")[0], `${name.split("/")[1]}.json`), "utf8")
  );
}

// ===== Pure-JS Merkle tree (sorted-pair, OpenZeppelin compatible) =====
function hashLeaf(user, token, week, amount) {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "uint256", "uint256"],
    [user, token, week, amount]
  );
  const innerHash = ethers.keccak256(encoded);
  return ethers.keccak256(innerHash);
}

function hashPair(a, b) {
  // sortPairs: true (samakan urutan biar match OZ MerkleProof.verify)
  const [lo, hi] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  return ethers.keccak256(ethers.concat([lo, hi]));
}

function buildTree(leaves) {
  if (leaves.length === 0) return { root: ethers.ZeroHash, layers: [[]] };
  let layer = [...leaves];
  const layers = [layer];
  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      if (i + 1 < layer.length) {
        next.push(hashPair(layer[i], layer[i + 1]));
      } else {
        next.push(layer[i]); // odd leaf carried up
      }
    }
    layer = next;
    layers.push(layer);
  }
  return { root: layer[0], layers };
}

function getProof(layers, leafIndex) {
  const proof = [];
  let idx = leafIndex;
  for (let level = 0; level < layers.length - 1; level++) {
    const layer = layers[level];
    const isRight = idx % 2 === 1;
    const pairIdx = isRight ? idx - 1 : idx + 1;
    if (pairIdx < layer.length) {
      proof.push(layer[pairIdx]);
    }
    idx = Math.floor(idx / 2);
  }
  return proof;
}

const STOCKS = ["TSLA", "AMZN", "NFLX", "PLTR", "AMD", "USDG"];
const USERS = (process.env.WATCH_USERS || "").split(",").map(s => s.trim()).filter(Boolean);
const EXEC = process.env.EXEC === "1";

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.ROBIN_RPC || process.env.ROBIN_RPC_PUBLIC);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const vault = new ethers.Contract(
    DEPLOY.contracts.vault,
    artifact("RobinIndexVault_v0.8.0.sol/RobinIndexVault").abi,
    provider
  );
  const treasury = new ethers.Contract(
    DEPLOY.contracts.treasury,
    artifact("FeeTreasury_v0.8.1.sol/FeeTreasury").abi,
    provider
  );
  const distributor = new ethers.Contract(
    DEPLOY.contracts.rewardDistributor,
    artifact("RewardDistributor_v0.8.1.sol/RewardDistributor").abi,
    wallet
  );

  const currentWeek = await distributor.currentWeek();

  console.log("========================================");
  console.log(" Robin Index Vault Merkle Generator (pure-JS)");
  console.log("========================================");
  console.log("Mode     :", EXEC ? "EXECUTE" : "DRY-RUN");
  console.log("Week     :", currentWeek.toString());
  console.log("Users    :", USERS.join(", "));
  console.log("");

  for (const symbol of STOCKS) {
    const tokenAddr = ethers.getAddress(DEPLOY.tokens[symbol].address);
    const decimals = DEPLOY.tokens[symbol].decimals;

    const canDist = await treasury.canDistribute(tokenAddr);
    if (!canDist) { console.log(`[${symbol}] canDistribute=false, skip`); continue; }

    const rewardsBucket = (await treasury.getBuckets(tokenAddr))[1];
    if (rewardsBucket === 0n) { console.log(`[${symbol}] Rewards bucket kosong, skip`); continue; }

    console.log(`[${symbol}] Rewards bucket: ${ethers.formatUnits(rewardsBucket, decimals)} ${symbol}`);

    const existingRoot = await distributor.merkleRoots(tokenAddr, currentWeek);
    if (existingRoot !== ethers.ZeroHash) { console.log(`[${symbol}] Root sudah ada, skip`); continue; }

    const allocations = [];
    let totalDeposited = 0n;
    for (const user of USERS) {
      const deposited = await vault.userTotalDeposited(user, tokenAddr);
      if (deposited > 0n) {
        allocations.push({ user, deposited });
        totalDeposited += deposited;
      }
    }
    if (allocations.length === 0) { console.log(`[${symbol}] Tidak ada user eligible, skip`); continue; }

    console.log(`[${symbol}] Total deposited: ${ethers.formatUnits(totalDeposited, decimals)}`);
    console.log(`[${symbol}] Eligible users: ${allocations.length}`);

    const rewards = allocations.map((a) => ({
      user: a.user,
      amount: ((rewardsBucket * a.deposited) / totalDeposited).toString(),
    }));

    const leaves = rewards.map((r) => hashLeaf(r.user, tokenAddr, currentWeek, r.amount));
    const { root, layers } = buildTree(leaves);

    console.log(`[${symbol}] Merkle Root: ${root}`);

    const proofs = {};
    rewards.forEach((r, i) => {
      proofs[r.user] = { amount: r.amount, proof: getProof(layers, i) };
    });

    const proofsDir = path.join(ROOT_DIR, "frontend", "public", "merkle-proofs");
    fs.mkdirSync(proofsDir, { recursive: true });
    fs.writeFileSync(
      path.join(proofsDir, `week-${currentWeek}-${symbol.toLowerCase()}.json`),
      JSON.stringify(proofs, null, 2)
    );
    console.log(`[${symbol}] Proofs saved to public/merkle-proofs/`);

    if (EXEC) {
      try {
        const tx = await distributor.setMerkleRoot(tokenAddr, currentWeek, root);
        await tx.wait();
        console.log(`[${symbol}] ✅ Root uploaded! TX: ${tx.hash}`);
      } catch (err) {
        console.error(`[${symbol}] ❌ Upload failed:`, err.shortMessage || err.message);
      }
    } else {
      console.log(`[${symbol}] DRY-RUN: would upload root`);
    }
    console.log("");
  }

  console.log("✅ Merkle generator complete");
}

main().catch((err) => {
  console.error("❌ Merkle generator failed:", err.message);
  process.exit(1);
});
