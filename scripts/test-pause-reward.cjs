require("dotenv").config();
const { ethers } = require("ethers");

const ABI = [
  "function paused() view returns(bool)",
  "function pause()",
  "function unpause()"
];

const provider = new ethers.JsonRpcProvider(process.env.ROBIN_RPC);

const signer = new ethers.Wallet(
  process.env.PRIVATE_KEY,
  provider
);

const reward = new ethers.Contract(
  "0x30a6dDfCf8e1Fa11Ce5B2A9745c54123A74e0d15",
  ABI,
  signer
);

(async () => {
  console.log("before =", await reward.paused());

  const tx = await reward.pause();
  await tx.wait();

  console.log("after pause =", await reward.paused());

  const tx2 = await reward.unpause();
  await tx2.wait();

  console.log("after unpause =", await reward.paused());
})();
