// Allot Split with non-standard tokens, on a local EVM. Pins the behaviour described in SPLIT.md.
import ganache from "ganache"; import { createPublicClient, createWalletClient, custom, decodeEventLog, encodeFunctionData } from "viem"; import fs from "fs"; import solc from "solc";
const src = (f) => ({ content: fs.readFileSync(new URL(f, import.meta.url), "utf8") });
const out = JSON.parse(solc.compile(JSON.stringify({ language: "Solidity", sources: { "AllotSplit.sol": src("../AllotSplit.sol"), "MockTokens.sol": src("./MockTokens.sol") }, settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "shanghai", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } } })));
const C = (f, n) => ({ abi: out.contracts[f][n].abi, bytecode: "0x" + out.contracts[f][n].evm.bytecode.object });
const B = { S: C("AllotSplit.sol", "AllotSplit"), F: C("AllotSplit.sol", "AllotSplitFactory"), FEE: C("MockTokens.sol", "FeeToken"), REB: C("MockTokens.sol", "RebaseToken") };
const prov = ganache.provider({ logging: { quiet: true }, chain: { hardfork: "shanghai" }, wallet: { totalAccounts: 6 }, miner: { blockGasLimit: 60_000_000 } });
const [me, x, p1, p2] = await prov.request({ method: "eth_accounts" }); const pub = createPublicClient({ transport: custom(prov) }); const chain = { id: await pub.getChainId(), name: "g", nativeCurrency: { name: "E", symbol: "E", decimals: 18 }, rpcUrls: { default: { http: [] } } };
const W = (a) => createWalletClient({ account: a, transport: custom(prov) });
const deploy = async (b, args = []) => (await pub.waitForTransactionReceipt({ hash: await W(me).deployContract({ abi: b.abi, bytecode: b.bytecode, args, chain, gas: 8_000_000n }) })).contractAddress;
const send = async (to, b, fn, args) => pub.waitForTransactionReceipt({ hash: await W(x).writeContract({ address: to, abi: b.abi, functionName: fn, args, chain, gas: 3_000_000n }) });
const read = (to, b, fn, args = []) => pub.readContract({ address: to, abi: b.abi, functionName: fn, args });
const call = async (to, b, fn, args) => { try { await prov.request({ method: "eth_call", params: [{ from: x, to, data: encodeFunctionData({ abi: b.abi, functionName: fn, args }) }, "latest"] }); return "ok"; } catch (e) { return "reverts"; } };
let pass = 0, fail = 0; const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"}  ${m}`); c ? pass++ : fail++; };
const fac = await deploy(B.F); const rc = await send(fac, B.F, "create", [[p1, p2], [50n, 50n]]);
const S = rc.logs.map((l) => { try { return decodeEventLog({ abi: B.F.abi, data: l.data, topics: l.topics }); } catch { return null; } }).find(Boolean).args.split;
// fee-on-transfer: payees get 1% less than their accounted share, the accounting itself stays consistent
const fee = await deploy(B.FEE); await send(fee, B.FEE, "mint", [S, 1_000_000n]); await send(S, B.S, "releaseAll", [fee]);
ok((await read(fee, B.FEE, "balanceOf", [p1])) === 495_000n && (await read(fee, B.FEE, "balanceOf", [p2])) === 495_000n, "fee token: each payee accounted 500000, received 495000 (the token kept 1%)");
ok((await read(S, B.S, "released", [fee, p1])) === 500_000n && (await read(fee, B.FEE, "balanceOf", [S])) === 0n, "fee token: Split accounts the full share and holds nothing after");
// negative rebase after a partial release: releasable() underflows and reverts for the payee already paid
const reb = await deploy(B.REB); await send(reb, B.REB, "mint", [S, 1_000_000n]); await send(S, B.S, "release", [reb, p1]); // p1 gets 500000, 500000 left for p2
await send(reb, B.REB, "shrink", [S, 400_000n]); // Split now holds 100000: received looks like 600000, p1 already got 500000 > its 300000 share
ok((await call(S, B.S, "releasable", [reb, p1])) === "reverts", "rebase token: releasable() reverts for the payee already paid more than its new share (documented)");
const due2 = await read(S, B.S, "releasable", [reb, p2]);
ok(due2 === 300_000n, "rebase token: releasable() for the other payee says 300000, more than the 100000 the Split still holds");
ok((await call(S, B.S, "release", [reb, p2])) === "reverts", "rebase token: so its release reverts (token transfer failed) until enough arrives again");
await send(S, B.S, "releaseAll", [reb]); ok((await read(reb, B.REB, "balanceOf", [p2])) === 0n && (await read(reb, B.REB, "balanceOf", [S])) === 100_000n, "rebase token: releaseAll pays nobody, the 100000 stays in the Split");
await send(reb, B.REB, "mint", [S, 400_000n]); // Split holds 500000 again: received 1000000, p2's share 500000 is covered
await send(S, B.S, "release", [reb, p2]);
ok((await read(reb, B.REB, "balanceOf", [p2])) === 500_000n && (await read(reb, B.REB, "balanceOf", [S])) === 0n, "rebase token: once the balance covers it again, the other payee is paid in full and the Split is empty");
console.log(`${pass} passed, ${fail} failed`);
