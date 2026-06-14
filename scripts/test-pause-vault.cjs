const { ethers } = require("ethers");
require("dotenv").config();

const RPC = process.env.ROBIN_RPC;
const PK = process.env.PRIVATE_KEY;

const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(PK, provider);

const VAULT = "0xD39a604Ddc92115C5cB0F70fc85AC5581D9e81A7";

const abi = [
  "function paused() view returns (bool)",
  "function pause()",
  "function unpause()"
];

(async () => {
  const vault = new ethers.Contract(VAULT, abi, wallet);

  console.log("before =", await vault.paused());

  let tx = await vault.pause();
  await tx.wait();

  console.log("after pause =", await vault.paused());

  tx = await vault.unpause();
  await tx.wait();

  console.log("after unpause =", await vault.paused());
})();
