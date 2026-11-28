// Allot Split against a malicious token that re-enters release() and releaseAll() on every transfer. Local EVM.
import ganache from "ganache"; import { createPublicClient, createWalletClient, custom, decodeEventLog } from "viem"; import fs from "fs"; import solc from "solc";
const src = (f) => ({ content: fs.readFileSync(new URL(f, import.meta.url), "utf8") });
const out = JSON.parse(solc.compile(JSON.stringify({ language: "Solidity", sources: { "AllotSplit.sol": src("../AllotSplit.sol"), "ReentrantToken.sol": src("./ReentrantToken.sol") }, settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "shanghai", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } } })));
for (const e of out.errors || []) if (e.severity === "error") { console.log(e.formattedMessage); process.exit(1); }
const C = (f, n) => ({ abi: out.contracts[f][n].abi, bytecode: "0x" + out.contracts[f][n].evm.bytecode.object });
const S = C("AllotSplit.sol", "AllotSplit"), F = C("AllotSplit.sol", "AllotSplitFactory"), R = C("ReentrantToken.sol", "ReentrantToken");
const prov = ganache.provider({ logging: { quiet: true }, chain: { hardfork: "shanghai" }, wallet: { totalAccounts: 5 }, miner: { blockGasLimit: 60_000_000 } });
const [me, x, p1, p2, p3] = await prov.request({ method: "eth_accounts" }); const pub = createPublicClient({ transport: custom(prov) }); const chain = { id: await pub.getChainId(), name: "g", nativeCurrency: { name: "E", symbol: "E", decimals: 18 }, rpcUrls: { default: { http: [] } } };
const W = (a) => createWalletClient({ account: a, transport: custom(prov) });
const deploy = async (b) => (await pub.waitForTransactionReceipt({ hash: await W(me).deployContract({ abi: b.abi, bytecode: b.bytecode, chain, gas: 8_000_000n }) })).contractAddress;
const send = async (to, b, fn, args) => pub.waitForTransactionReceipt({ hash: await W(x).writeContract({ address: to, abi: b.abi, functionName: fn, args, chain, gas: 5_000_000n }) });
const read = (to, b, fn, args = []) => pub.readContract({ address: to, abi: b.abi, functionName: fn, args });
let pass = 0, fail = 0; const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"}  ${m}`); c ? pass++ : fail++; };
const fac = await deploy(F);
for (const useAll of [false, true]) {
  const rc = await send(fac, F, "create", [[p1, p2, p3], [50n, 30n, 20n]]);
  const sp = rc.logs.map((l) => { try { return decodeEventLog({ abi: F.abi, data: l.data, topics: l.topics }); } catch { return null; } }).find(Boolean).args.split;
  const tok = await deploy(R); await send(tok, R, "mint", [sp, 1_000_000n]); await send(tok, R, "arm", [sp, p1, useAll]);
  if (useAll) await send(sp, S, "releaseAll", [tok]); else await send(sp, S, "release", [tok, p1]);
  const [b1, b2, b3, bs, at] = await Promise.all([read(tok, R, "balanceOf", [p1]), read(tok, R, "balanceOf", [p2]), read(tok, R, "balanceOf", [p3]), read(tok, R, "balanceOf", [sp]), read(tok, R, "attacks")]);
  const label = useAll ? "releaseAll re-entered" : "release re-entered";
  ok(at > 0n, `${label}: the token called back into the Split ${at} times`);
  ok(b1 <= 500_000n && b2 <= 300_000n && b3 <= 200_000n, `${label}: nobody got more than their share (${b1} / ${b2} / ${b3})`);
  ok(b1 + b2 + b3 + bs === 1_000_000n, `${label}: paid out + left in the Split = exactly what came in`);
  await send(tok, R, "arm", ["0x0000000000000000000000000000000000000000", p1, useAll]); await send(sp, S, "releaseAll", [tok]);
  const [c1, c2, c3, cs] = await Promise.all([read(tok, R, "balanceOf", [p1]), read(tok, R, "balanceOf", [p2]), read(tok, R, "balanceOf", [p3]), read(tok, R, "balanceOf", [sp])]);
  ok(c1 === 500_000n && c2 === 300_000n && c3 === 200_000n && cs === 0n, `${label}: after the attack, every payee ends with exactly its share`);
}
console.log(`${pass} passed, ${fail} failed`);
