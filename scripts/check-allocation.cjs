const { ethers } = require("ethers");
require("dotenv").config();

const RPC = process.env.ROBIN_RPC;

const REWARD = "0x30a6dDfCf8e1Fa11Ce5B2A9745c54123A74e0d15";
const TOKEN  = "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E"; // TSLA

const USER = process.argv[2];

const ABI = [
  "function currentWeek() view returns(uint256)",
  "function allocation(address,address,uint256) view returns(uint256)",
  "function claimable(address,address,uint256) view returns(uint256)"
];

(async () => {
  const provider = new ethers.JsonRpcProvider(RPC);

  const reward = new ethers.Contract(
    REWARD,
    ABI,
    provider
  );

  const week = await reward.currentWeek();

  const alloc = await reward.allocation(
    USER,
    TOKEN,
    week
  );

  const claimable = await reward.claimable(
    USER,
    TOKEN,
    week
  );

  console.log("week      =", week.toString());
  console.log("allocation=", ethers.formatEther(alloc));
  console.log("claimable =", ethers.formatEther(claimable));
})();
