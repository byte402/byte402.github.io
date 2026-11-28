import ganache from "ganache"; import { createPublicClient, createWalletClient, custom, decodeEventLog, encodeFunctionData, decodeErrorResult } from "viem"; import fs from "fs";
const B = JSON.parse(fs.readFileSync(process.env.BUILD || "build.json")); const prov = ganache.provider({ logging: { quiet: true }, chain: { hardfork: "shanghai" }, wallet: { totalAccounts: 16, defaultBalance: 1000 }, miner: { blockGasLimit: 60_000_000 } });
const accts = await prov.request({ method: "eth_accounts" }); const pub = createPublicClient({ transport: custom(prov) }); const W = (a) => createWalletClient({ account: a, transport: custom(prov) });
const [me, stranger, ...P] = accts; const chain = { id: await pub.getChainId(), name: "g", nativeCurrency: { name: "E", symbol: "E", decimals: 18 }, rpcUrls: { default: { http: [] } } };
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log("FAIL", m)); };
const deploy = async (n, args = []) => { const h = await W(me).deployContract({ abi: B[n].abi, bytecode: B[n].bytecode, args, chain, gas: 8_000_000n }); return (await pub.waitForTransactionReceipt({ hash: h })).contractAddress; };
const send = async (from, address, n, fn, args) => { const h = await W(from).writeContract({ address, abi: B[n].abi, functionName: fn, args, chain, gas: 3_000_000n }); return pub.waitForTransactionReceipt({ hash: h }); };
const read = (address, n, fn, args = []) => pub.readContract({ address, abi: B[n].abi, functionName: fn, args });
const sim = async (from, address, n, fn, args) => { const data = encodeFunctionData({ abi: B[n].abi, functionName: fn, args });
  try { await prov.request({ method: "eth_call", params: [{ from, to: address, data, gas: "0x2dc6c0" }, "latest"] }); return { ok: true }; }
  catch (e) { const d = e.data?.result || e.data || ""; let why = String(e.message); try { why = decodeErrorResult({ abi: [...B[n].abi, ...B.AllotSplit.abi], data: d }).args[0]; } catch {} throw new Error("reverted: " + why); } };
const reverts = async (p, why) => { try { const r = await p; if (r && r.status === "reverted") return !why; return false; } catch (e) { const t = String(e.message) + " " + String(e.shortMessage || "") + " " + JSON.stringify(e.metaMessages || ""); if (why && !t.includes(why)) console.log("  reason was:", t.slice(0, 200)); return !why || t.includes(why); } };
const tok = await deploy("TestUSDG"), fac = await deploy("AllotSplitFactory");
// 1. create through the factory
const rc = await send(me, fac, "AllotSplitFactory", "create", [[P[0], P[1], P[2]], [70n, 20n, 10n]]);
const ev = rc.logs.map((l) => { try { return decodeEventLog({ abi: B.AllotSplitFactory.abi, data: l.data, topics: l.topics }); } catch { return null; } }).find(Boolean);
const S = ev.args.split; ok(ev.eventName === "SplitCreated" && ev.args.creator.toLowerCase() === me.toLowerCase(), "event"); ok((await read(fac, "AllotSplitFactory", "splitsOf", [me]))[0] === S, "splitsOf");
ok((await read(S, "AllotSplit", "totalShares")) === 100n, "totalShares"); ok((await read(S, "AllotSplit", "payees")).length === 3, "payees");
console.log("factory create gas", rc.gasUsed);
// 2. 1 USDG in, releaseAll by a stranger
await send(me, tok, "TestUSDG", "mint", [S, 1_000_000n]);
ok((await read(S, "AllotSplit", "releasable", [tok, P[0]])) === 700_000n, "releasable 70%");
const ra = await send(stranger, S, "AllotSplit", "releaseAll", [tok]); console.log("releaseAll gas (3 payees)", ra.gasUsed);
const bal = async (a) => read(tok, "TestUSDG", "balanceOf", [a]);
ok((await bal(P[0])) === 700_000n && (await bal(P[1])) === 200_000n && (await bal(P[2])) === 100_000n && (await bal(S)) === 0n, "split 70/20/10");
ok((await bal(stranger)) === 0n, "stranger got nothing");
// 3. no double pay
await send(stranger, S, "AllotSplit", "releaseAll", [tok]); ok((await bal(P[0])) === 700_000n, "no double pay");
// 4. dust: 7 units, then 3 more
await send(me, tok, "TestUSDG", "mint", [S, 7n]); await send(stranger, S, "AllotSplit", "releaseAll", [tok]);
ok((await bal(S)) === 2n, "dust stays (7 -> 4,1,0)"); await send(me, tok, "TestUSDG", "mint", [S, 3n]); await send(stranger, S, "AllotSplit", "releaseAll", [tok]);
ok((await bal(P[0])) === 700_007n && (await bal(P[1])) === 200_002n && (await bal(P[2])) === 100_001n && (await bal(S)) === 0n, "dust paid later, exact");
// 5. a payee that cannot receive does not block the others
await send(me, tok, "TestUSDG", "setBlocked", [P[1]]); await send(me, tok, "TestUSDG", "mint", [S, 1_000_000n]); await send(stranger, S, "AllotSplit", "releaseAll", [tok]);
ok((await bal(P[0])) === 1_400_007n && (await bal(P[2])) === 200_001n && (await bal(P[1])) === 200_002n && (await bal(S)) === 200_000n, "blocked payee skipped, others paid");
ok(await reverts(sim(stranger, S, "AllotSplit", "release", [tok, P[1]]), "token transfer failed"), "direct release to blocked reverts");
await send(me, tok, "TestUSDG", "setBlocked", ["0x0000000000000000000000000000000000000000"]); await send(stranger, S, "AllotSplit", "release", [tok, P[1]]);
ok((await bal(P[1])) === 400_002n && (await bal(S)) === 0n, "blocked payee paid after unblock");
// 6. release to a non-payee reverts, and tokens can only go to payees
ok(await reverts(sim(stranger, S, "AllotSplit", "release", [tok, stranger]), "not a payee"), "non-payee");
// 7. bad constructors
const make = (p, s) => send(me, fac, "AllotSplitFactory", "create", [p, s]); const bad = (p, s) => sim(me, fac, "AllotSplitFactory", "create", [p, s]);
ok(await reverts(bad([P[0]], [1n]), "2 to 10 payees"), "1 payee"); ok(await reverts(bad(P.slice(0, 11).concat([stranger]).slice(0, 11), Array(11).fill(1n)), "2 to 10 payees"), "11 payees");
ok(await reverts(bad([P[0], "0x0000000000000000000000000000000000000000"], [1n, 1n]), "zero address"), "zero address");
ok(await reverts(bad([P[0], P[1]], [1n, 0n]), "share is zero"), "zero share"); ok(await reverts(bad([P[0], P[0]], [1n, 1n]), "listed twice"), "duplicate");
ok(await reverts(bad([P[0], P[1]], [1n]), "one share per payee"), "length mismatch");
const r10 = await make(P.slice(0, 10), Array(10).fill(1n)); ok(r10.status === "success", "10 payees ok");
// 8. fuzz: random shares and payments, invariant and exact final amounts
for (let round = 0; round < 25; round++) {
  const n = 2 + Math.floor(Math.random() * 9), ps = P.slice(0, n), sh = ps.map(() => BigInt(1 + Math.floor(Math.random() * 10000)));
  const r = await make(ps, sh); const sp = r.logs.map((l) => { try { return decodeEventLog({ abi: B.AllotSplitFactory.abi, data: l.data, topics: l.topics }); } catch { return null; } }).find(Boolean).args.split;
  const before = await Promise.all(ps.map(bal)); let got = 0n; const tot = sh.reduce((a, b) => a + b, 0n);
  for (let k = 0; k < 4; k++) { const amt = BigInt(Math.floor(Math.random() * 5_000_000)); got += amt; await send(me, tok, "TestUSDG", "mint", [sp, amt]);
    if (Math.random() < 0.5) await send(stranger, sp, "AllotSplit", "releaseAll", [tok]); else await send(stranger, sp, "AllotSplit", "release", [tok, ps[Math.floor(Math.random() * n)]]); }
  await send(stranger, sp, "AllotSplit", "releaseAll", [tok]);
  const after = await Promise.all(ps.map(bal)); let paid = 0n, exact = true;
  for (let i = 0; i < n; i++) { const d = after[i] - before[i]; paid += d; if (d !== (got * sh[i]) / tot) exact = false; }
  const left = await bal(sp); ok(exact, "fuzz exact share r" + round); ok(paid + left === got && left < BigInt(n), "fuzz invariant r" + round);
}
console.log("pass", pass, "fail", fail);
