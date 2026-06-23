import fs from "fs";
import path from "path";

export function loadArtifact(rootDir, name) {
  const candidates = [
    path.join(rootDir, "artifacts", "contracts", `${name}_v0.8.3.sol`, `${name}.json`),
    path.join(rootDir, "artifacts", "contracts", `${name}_v0.8.1.sol`, `${name}.json`),
    path.join(rootDir, "artifacts", "contracts", `${name}_v0.8.0.sol`, `${name}.json`),
    path.join(rootDir, "artifacts", "contracts", `${name}.sol`, `${name}.json`),
    path.join(rootDir, "artifacts", `${name}.json`),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  }
  throw new Error(`artifact not found for ${name}, tried:\n` + candidates.join("\n"));
}
