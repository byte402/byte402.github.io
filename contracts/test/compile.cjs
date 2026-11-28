const solc = require("solc"), fs = require("fs");
const src = (f) => ({ content: fs.readFileSync(new URL("../" + f, "file://" + __dirname + "/"), "utf8") });
const input = { language: "Solidity", sources: { "AllotSplit.sol": src("AllotSplit.sol"), "TestTokens.sol": src("TestTokens.sol") },
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: process.env.EVM || "cancun", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } } } };
const out = JSON.parse(solc.compile(JSON.stringify(input))); let bad = 0;
for (const e of out.errors || []) { console.log(e.severity, e.formattedMessage); if (e.severity === "error") bad++; }
if (bad) process.exit(1);
const all = {}; for (const [f, n] of [["AllotSplit.sol", "AllotSplit"], ["AllotSplit.sol", "AllotSplitFactory"], ["TestTokens.sol", "TestUSDG"]]) { const c = out.contracts[f][n]; all[n] = { abi: c.abi, bytecode: "0x" + c.evm.bytecode.object }; console.log(n, "init", c.evm.bytecode.object.length / 2, "runtime", c.evm.deployedBytecode.object.length / 2); }
fs.writeFileSync(process.env.OUT || "build.json", JSON.stringify(all)); console.log("solc", solc.version());
