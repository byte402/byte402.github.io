// Vault v2 per-payee budgets, on Robinhood Chain mainnet state with the real USDG, via eth_simulateV1. Nothing is sent.
import fs from "node:fs";
import { encodeFunctionData, encodeDeployData, decodeErrorResult, decodeEventLog, getContractAddress, parseAbi, keccak256, encodeAbiParameters, pad, toHex, getAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
const RPC = "https://rpc.mainnet.chain.robinhood.com", USDG = getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
const V = JSON.parse(fs.readFileSync(new URL("./build/AllotVault.json", import.meta.url), "utf8")), F = JSON.parse(fs.readFileSync(new URL("./build/AllotFactory.json", import.meta.url), "utf8"));
const T = parseAbi(["function balanceOf(address) view returns (uint256)", "function DOMAIN_SEPARATOR() view returns (bytes32)", "function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,bytes signature)"]);
const rpc = async (m, p) => { for (let k = 0; k < 12; k++) { const j = await (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: m, params: p }) })).json(); if (j.error?.code === 429) { await new Promise((r) => setTimeout(r, 1500)); continue; } if (j.error) throw new Error(JSON.stringify(j.error)); return j.result; } };
const acct = () => privateKeyToAccount(generatePrivateKey()).address;
const DEPLOYER = acct(), USER = acct(), AGENT = acct(), A = acct(), B = acct(), STRANGER = acct(), RELAYER = acct();
const DS = await rpc("eth_call", [{ to: USDG, data: encodeFunctionData({ abi: T, functionName: "DOMAIN_SEPARATOR" }) }, "latest"]);
const FACTORY = getContractAddress({ from: DEPLOYER, nonce: 0n });
const VAULT = getContractAddress({ opcode: "CREATE2", from: FACTORY, salt: keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [USER, 0n])), bytecode: encodeDeployData({ abi: V.abi, bytecode: V.bytecode, args: [USER, USDG, DS] }) });
const balSlot = (a) => keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [a, 1n]));
const U = (x) => BigInt(Math.round(x * 1e6)), ETH = "0x8ac7230489e80000";
const v = (fn, a) => encodeFunctionData({ abi: V.abi, functionName: fn, args: a }), tk = (fn, a) => encodeFunctionData({ abi: T, functionName: fn, args: a });
const blk = await rpc("eth_getBlockByNumber", ["latest", false]), t0 = Number(blk.timestamp), day0 = Math.floor(t0 / 86400);
const t1 = (day0 + 1) * 86400 - 600, t2 = (day0 + 1) * 86400 + 600; // late today, then early tomorrow (UTC)
const vb = BigInt(t2 + 3600), nn = (s) => keccak256(toHex(s + Math.random()));
const blocks = [[], []]; let cur = 0; const add = (label, from, to, data, expect, abi = V.abi) => blocks[cur].push({ label, call: { from, to, data, gas: "0x4c4b40" }, expect, abi });
const n1 = nn("a1"), n2 = nn("a2"), n3 = nn("b1");
blocks[0].push({ label: "deploy factory v2", call: { from: DEPLOYER, data: encodeDeployData({ abi: F.abi, bytecode: F.bytecode, args: [USDG, DS] }), gas: "0x7a1200" }, expect: "ok", abi: F.abi });
add("user creates a v2 vault", USER, FACTORY, encodeFunctionData({ abi: F.abi, functionName: "create" }), "ok", F.abi);
add("vault reports VERSION 2", RELAYER, VAULT, v("VERSION", []), "read:version");
add("AI: 0.05 per payment, 0.15 per day", USER, VAULT, v("setAgent", [AGENT, U(0.05), U(0.15), 0n, true]), "ok");
add("stranger tries setPayeeRule", STRANGER, VAULT, v("setPayeeRule", [AGENT, A, true, U(1)]), "revert:NotOwner");
add("payee A approved with its own 0.08 per day", USER, VAULT, v("setPayeeRule", [AGENT, A, true, U(0.08)]), "ok:events");
add("payee B approved, no per-payee limit", USER, VAULT, v("setPayeeRule", [AGENT, B, true, 0n]), "ok");
add("remaining for A = 0.08", RELAYER, VAULT, v("remainingTodayFor", [AGENT, A]), "read:remA0");
add("x402 to A for 0.05", AGENT, VAULT, v("authorize", [A, U(0.05), 0n, vb, n1, pad("0x01")]), "ok");
add("x402 to A for 0.05 again (0.10 > A's 0.08)", AGENT, VAULT, v("authorize", [A, U(0.05), 0n, vb, n2, pad("0x02")]), "revert:over today's limit for this payee");
add("direct 0.03 to A (A now at 0.08)", AGENT, VAULT, v("pay", [A, U(0.03), pad("0x03")]), "ok");
add("direct 0.01 to A (over A's limit)", AGENT, VAULT, v("pay", [A, U(0.01), pad("0x04")]), "revert:over today's limit for this payee");
add("remaining for A = 0", RELAYER, VAULT, v("remainingTodayFor", [AGENT, A]), "read:remA1");
add("remaining for B = 0.07 (agent day budget left)", RELAYER, VAULT, v("remainingTodayFor", [AGENT, B]), "read:remB1");
add("x402 to B for 0.05 (B has no own limit)", AGENT, VAULT, v("authorize", [B, U(0.05), 0n, vb, n3, pad("0x05")]), "ok");
add("direct 0.03 to B (agent's 0.15 day budget is the limit)", AGENT, VAULT, v("pay", [B, U(0.03), pad("0x06")]), "revert:over today's x402 limit");
add("AI releases the unsettled x402 #1 to A", AGENT, VAULT, v("release", [A, U(0.05), 0n, vb, n1]), "ok");
add("remaining for A back to 0.05", RELAYER, VAULT, v("remainingTodayFor", [AGENT, A]), "read:remA2");
add("direct 0.05 to A after release", AGENT, VAULT, v("pay", [A, U(0.05), pad("0x07")]), "ok");
add("relayer settles the x402 to B", RELAYER, USDG, tk("transferWithAuthorization", [VAULT, B, U(0.05), 0n, vb, n3, "0x"]), "ok", T);
add("owner removes A", USER, VAULT, v("setPayeeRule", [AGENT, A, false, 0n]), "ok");
add("remaining for removed A = 0", RELAYER, VAULT, v("remainingTodayFor", [AGENT, A]), "read:remA3");
add("direct 0.01 to removed A", AGENT, VAULT, v("pay", [A, U(0.01), pad("0x08")]), "revert:payee not on the list");
add("owner adds A back, 0.08 per day", USER, VAULT, v("setPayeeRule", [AGENT, A, true, U(0.08)]), "ok");
add("still same day: A is at its limit", AGENT, VAULT, v("pay", [A, U(0.01), pad("0x09")]), "revert:over today's limit for this payee");
cur = 1; // next UTC day
add("new UTC day: remaining for A = 0.05 (cap per payment is lower than A's 0.08 left? no: min(0.15 agent, 0.08 A))", RELAYER, VAULT, v("remainingTodayFor", [AGENT, A]), "read:remA4");
add("new day: direct 0.05 to A", AGENT, VAULT, v("pay", [A, U(0.05), pad("0x0a")]), "ok");
add("new day: direct 0.05 to A again (0.10 > 0.08)", AGENT, VAULT, v("pay", [A, U(0.05), pad("0x0b")]), "revert:over today's limit for this payee");
add("A received in total", RELAYER, USDG, tk("balanceOf", [A]), "read:balA", T);
add("B received in total", RELAYER, USDG, tk("balanceOf", [B]), "read:balB", T);
const ov = { [USDG]: { stateDiff: { [balSlot(VAULT)]: pad(toHex(U(5))) } } }; for (const a of [DEPLOYER, USER, AGENT, STRANGER, RELAYER]) ov[a] = { balance: ETH };
const res = await rpc("eth_simulateV1", [{ blockStateCalls: [{ blockOverrides: { time: "0x" + t1.toString(16) }, stateOverrides: ov, calls: blocks[0].map((s) => s.call) }, { blockOverrides: { time: "0x" + t2.toString(16) }, calls: blocks[1].map((s) => s.call) }], validation: false }, "latest"]);
let pass = 0, fail = 0; const reads = {}, steps = blocks.flat(), calls = res.flatMap((b) => b.calls);
calls.forEach((r, i) => { const s = steps[i], ok = r.status === "0x1", rd = r.error?.data || r.returnData;
  if (s.expect.startsWith("read:")) { reads[s.expect.slice(5)] = r.returnData; return; }
  let why = ""; if (!ok && rd && rd !== "0x") { try { const d = decodeErrorResult({ abi: s.abi === T ? V.abi : s.abi, data: rd }); why = d.errorName + (d.args?.length ? ":" + d.args[0] : ""); } catch { why = "token refused"; } }
  let good = s.expect.startsWith("ok") ? ok : !ok && why.includes(s.expect.slice(7));
  if (s.expect === "ok:events") { const names = (r.logs || []).map((l) => { try { return decodeEventLog({ abi: V.abi, data: l.data, topics: l.topics }).eventName; } catch { return "?"; } }); good = good && names.includes("PayeeSet") && names.includes("PayeeLimitSet"); }
  good ? pass++ : fail++; console.log(`  ${good ? "✓" : "✗"}  ${s.label}${ok ? "" : "  → refused: " + why}`); });
const n = (k) => BigInt(reads[k]);
const extra = [["VERSION is 2", n("version") === 2n], ["remaining for A starts at 0.08", n("remA0") === U(0.08)], ["remaining for A is 0 at its limit", n("remA1") === 0n], ["remaining for B is 0.07 (agent budget)", n("remB1") === U(0.07)],
  ["release gave A's budget back (0.05)", n("remA2") === U(0.05)], ["removed payee has 0 remaining", n("remA3") === 0n], ["new UTC day: A has 0.08 again", n("remA4") === U(0.08)],
  ["A received 0.03 + 0.05 + 0.05 = 0.13", n("balA") === U(0.13)], ["B received 0.05", n("balB") === U(0.05)]];
for (const [l, x] of extra) { x ? pass++ : fail++; console.log(`  ${x ? "✓" : "✗"}  ${l}`); }
console.log(`block ${parseInt(res[0].number, 16)} → ${parseInt(res[1].number, 16)} · ${pass} passed, ${fail} failed`);
