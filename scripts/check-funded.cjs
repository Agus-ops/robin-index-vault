require("dotenv").config();

const { ethers } = require("ethers");

const RPC = process.env.ROBIN_RPC;

const REWARD =
  "0x30a6dDfCf8e1Fa11Ce5B2A9745c54123A74e0d15";

const TSLA =
  "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E";

const ABI = [
  "function currentWeek() view returns(uint256)",
  "function weekFunded(address,uint256) view returns(uint256)"
];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);

  const reward = new ethers.Contract(
    REWARD,
    ABI,
    provider
  );

  const week = await reward.currentWeek();

  const funded = await reward.weekFunded(
    TSLA,
    week
  );

  console.log("week =", week.toString());
  console.log(
    "funded =",
    ethers.formatUnits(funded, 18)
  );
}

main().catch(console.error);
