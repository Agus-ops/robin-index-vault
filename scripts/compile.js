import fs from "fs";
import path from "path";
import solc from "solc";

const ROOT = process.cwd();
const CONTRACTS_DIR = path.join(ROOT, "contracts");
const ARTIFACTS_DIR = path.join(ROOT, "artifacts");

function walkSolFiles(dir) {
  const out = [];
  for (const item of fs.readdirSync(dir)) {
    const p = path.join(dir, item);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) out.push(...walkSolFiles(p));
    else if (item.endsWith(".sol")) out.push(p);
  }
  return out;
}

function rel(p) {
  return path.relative(ROOT, p).replaceAll("\\", "/");
}

const sources = {};
for (const file of walkSolFiles(CONTRACTS_DIR)) {
  sources[rel(file)] = { content: fs.readFileSync(file, "utf8") };
}

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: {
      enabled: true,
      runs: 200,
    },
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode", "evm.deployedBytecode"],
      },
    },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));

let hasError = false;

if (output.errors) {
  for (const e of output.errors) {
    const level = e.severity === "error" ? "ERROR" : "WARN ";
    console.log(`[${level}] ${e.formattedMessage}`);
    if (e.severity === "error") hasError = true;
  }
}

if (hasError) {
  console.error("Compile failed.");
  process.exit(1);
}

fs.rmSync(ARTIFACTS_DIR, { recursive: true, force: true });
fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

for (const [sourceName, contracts] of Object.entries(output.contracts || {})) {
  for (const [contractName, artifact] of Object.entries(contracts)) {
    const bytecode = artifact.evm?.bytecode?.object || "";
    if (!bytecode) continue;

    const fileName = `${contractName}.json`;
    fs.writeFileSync(
      path.join(ARTIFACTS_DIR, fileName),
      JSON.stringify(
        {
          sourceName,
          contractName,
          abi: artifact.abi,
          bytecode,
          deployedBytecode: artifact.evm.deployedBytecode.object,
        },
        null,
        2
      )
    );

    console.log(`✅ ${contractName} -> artifacts/${fileName}`);
  }
}

console.log("Compile OK.");
