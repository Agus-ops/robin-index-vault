require("dotenv").config();

const { ethers } = require("ethers");

const RPC = process.env.ROBIN_RPC;

const REWARD =
"0x30a6dDfCf8e1Fa11Ce5B2A9745c54123A74e0d15";

const TOKEN =
"0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E";

const USER =
process.argv[2];

const ABI = [
"function currentWeek() view returns(uint256)",
"function allocation(address,address,uint256) view returns(uint256)",
"function claimable(address,address,uint256) view returns(uint256)",
"function weekFunded(address,uint256) view returns(uint256)",
"function weekClaimedTotal(address,uint256) view returns(uint256)",
"function maxClaimPerUser(address,uint256) view returns(uint256)",
"function availableUnallocated(address) view returns(uint256)"
];

async function main() {

const provider =
new ethers.JsonRpcProvider(RPC);

const c =
new ethers.Contract(REWARD, ABI, provider);

const week =
await c.currentWeek();

console.log("week =", week.toString());

console.log(
"funded =",
ethers.formatEther(
await c.weekFunded(TOKEN, week)
)
);

console.log(
"claimedTotal =",
ethers.formatEther(
await c.weekClaimedTotal(TOKEN, week)
)
);

console.log(
"maxClaimPerUser =",
ethers.formatEther(
await c.maxClaimPerUser(TOKEN, week)
)
);

console.log(
"availableUnallocated =",
ethers.formatEther(
await c.availableUnallocated(TOKEN)
)
);

console.log(
"allocation =",
ethers.formatEther(
await c.allocation(USER, TOKEN, week)
)
);

console.log(
"claimable =",
ethers.formatEther(
await c.claimable(USER, TOKEN, week)
)
);

}

main().catch(console.error);
