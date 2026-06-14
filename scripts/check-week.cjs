const { ethers } = require("ethers");

const RPC = "https://rpc.testnet.chain.robinhood.com";
const provider = new ethers.JsonRpcProvider(RPC);

const REWARD = "0x30a6dDfCf8e1Fa11Ce5B2A9745c54123A74e0d15";

const abi = [
  "function currentWeek() view returns(uint256)"
];

async function main() {
  const c = new ethers.Contract(REWARD, abi, provider);

  const week = await c.currentWeek();

  console.log("currentWeek =", week.toString());
}

main();
