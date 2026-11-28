import { encodeFunctionData, decodeFunctionResult, getContractAddress, encodeDeployData } from "viem"; import fs from "fs";
const B = JSON.parse(fs.readFileSync("build.json")); const RPC = process.argv[2] || "https://rpc.mainnet.chain.robinhood.com";
const me = "0x" + [...crypto.getRandomValues(new Uint8Array(20))].map((b) => b.toString(16).padStart(2, "0")).join("");
const tok = getContractAddress({ from: me, nonce: 0n }), fac = getContractAddress({ from: me, nonce: 1n }), split = getContractAddress({ from: fac, nonce: 1n });
const P = ["0x00000000000000000000000000000000000000a1", "0x00000000000000000000000000000000000000a2", "0x00000000000000000000000000000000000000a3"];
const c = (to, n, fn, args) => ({ from: me, to, data: encodeFunctionData({ abi: B[n].abi, functionName: fn, args }) });
const calls = [{ from: me, data: encodeDeployData({ abi: B.TestUSDG.abi, bytecode: B.TestUSDG.bytecode }) }, { from: me, data: encodeDeployData({ abi: B.AllotSplitFactory.abi, bytecode: B.AllotSplitFactory.bytecode }) },
  c(fac, "AllotSplitFactory", "create", [P, [70n, 20n, 10n]]), c(tok, "TestUSDG", "mint", [split, 1_000_000n]), c(split, "AllotSplit", "releaseAll", [tok]),
  ...P.map((p) => c(tok, "TestUSDG", "balanceOf", [p])), c(tok, "TestUSDG", "balanceOf", [split]), c(split, "AllotSplit", "totalShares", [])];
const body = { jsonrpc: "2.0", id: 1, method: "eth_simulateV1", params: [{ blockStateCalls: [{ calls, stateOverrides: { [me]: { balance: "0x56bc75e2d63100000" } } }], validation: false, traceTransfers: false }, "latest"] };
const j = await (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
if (j.error) { console.log("RPC error", j.error); process.exit(1); }
const res = j.result[0].calls; res.forEach((r, i) => { if (r.status !== "0x1") console.log("call", i, "FAILED", r.error || r.returnData); });
const n = (i) => BigInt(res[i].returnData); console.log("chain", RPC.split("//")[1].split(".")[1], "| statuses", res.map((r) => r.status).join(","));
console.log("gas: deploy factory", Number(res[1].gasUsed), "create split", Number(res[2].gasUsed), "releaseAll", Number(res[4].gasUsed));
console.log("payees got", n(5), n(6), n(7), "| left in split", n(8), "| totalShares", n(9), (n(5) === 700000n && n(6) === 200000n && n(7) === 100000n && n(8) === 0n) ? "✅ exact 70/20/10" : "❌");
