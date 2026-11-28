// Compiles contracts/AllotVaultV2.sol with the deployed settings (solc 0.8.28, optimizer 200, cancun) into test/build/.
const solc = require("solc"), fs = require("fs"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "AllotVaultV2.sol"), "utf8");
const out = JSON.parse(solc.compile(JSON.stringify({ language: "Solidity", sources: { "AllotVaultV2.sol": { content: src } }, settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } } })));
for (const e of out.errors || []) { console.log(e.severity, e.formattedMessage); if (e.severity === "error") process.exit(1); }
fs.mkdirSync(path.join(__dirname, "build"), { recursive: true });
for (const n of ["AllotVault", "AllotFactory"]) { const c = out.contracts["AllotVaultV2.sol"][n]; fs.writeFileSync(path.join(__dirname, "build", n + ".json"), JSON.stringify({ abi: c.abi, bytecode: "0x" + c.evm.bytecode.object })); }
console.log("built", solc.version());
