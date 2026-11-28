// Vault v3 fixes, on Robinhood Chain mainnet state with the real USDG, via eth_simulateV1. Nothing is sent.
import fs from "node:fs";
import { encodeFunctionData, encodeDeployData, decodeErrorResult, decodeEventLog, getContractAddress, parseAbi, keccak256, encodeAbiParameters, pad, toHex, getAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
const RPC = "https://rpc.mainnet.chain.robinhood.com", USDG = getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
const dir = new URL("./build-v3/", import.meta.url);
const V = JSON.parse(fs.readFileSync(new URL("AllotVault.json", dir), "utf8")), F = JSON.parse(fs.readFileSync(new URL("AllotFactory.json", dir), "utf8"));
const T = parseAbi(["function balanceOf(address) view returns (uint256)", "function DOMAIN_SEPARATOR() view returns (bytes32)", "function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,bytes signature)"]);
const rpc = async (m, p) => { for (let k = 0; k < 14; k++) { const j = await (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: m, params: p }) })).json(); if (j.error?.code === 429) { await new Promise((r) => setTimeout(r, 5000 + 4000 * k)); continue; } if (j.error) throw new Error(JSON.stringify(j.error)); return j.result; } throw new Error("RPC rate limited, try again later"); };
const acct = () => privateKeyToAccount(generatePrivateKey()).address;
const DEPLOYER = acct(), USER = acct(), AGENT = acct(), P = acct(), Q = acct(), RELAYER = acct();
const DS = await rpc("eth_call", [{ to: USDG, data: encodeFunctionData({ abi: T, functionName: "DOMAIN_SEPARATOR" }) }, "latest"]);
const FACTORY = getContractAddress({ from: DEPLOYER, nonce: 0n });
const VAULT = getContractAddress({ opcode: "CREATE2", from: FACTORY, salt: keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [USER, 0n])), bytecode: encodeDeployData({ abi: V.abi, bytecode: V.bytecode, args: [USER, USDG, DS] }) });
const balSlot = (a) => keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [a, 1n]));
const U = (x) => BigInt(Math.round(x * 1e6)), ETH = "0x8ac7230489e80000";
const v = (fn, a) => encodeFunctionData({ abi: V.abi, functionName: fn, args: a }), tk = (fn, a) => encodeFunctionData({ abi: T, functionName: fn, args: a });
const now = Number((await rpc("eth_getBlockByNumber", ["latest", false])).timestamp), vb = BigInt(now + 600), nn = (s) => keccak256(toHex(s + Math.random()));
const settle = (to, amt, n) => tk("transferWithAuthorization", [VAULT, to, amt, 0n, vb, n, "0x"]);
const digest = (to, amt, n) => v("transferDigest", [to, amt, 0n, vb, n]);
const [n1, n2, n3, n4, n5, n6, n7] = ["a", "b", "c", "d", "e", "f", "g"].map(nn);
const ov = { [USDG]: { stateDiff: { [balSlot(VAULT)]: pad(toHex(U(5))) } } }; for (const a of [DEPLOYER, USER, AGENT, RELAYER]) ov[a] = { balance: ETH };
function setup() { const st = []; const add = (label, from, to, data, expect, abi = V.abi) => st.push({ label, call: { from, to, data, gas: "0x4c4b40" }, expect, abi });
  st.push({ label: "deploy factory v3", call: { from: DEPLOYER, data: encodeDeployData({ abi: F.abi, bytecode: F.bytecode, args: [USDG, DS] }), gas: "0x989680" }, expect: "setup", abi: F.abi });
  add("create vault", USER, FACTORY, encodeFunctionData({ abi: F.abi, functionName: "create" }), "setup", F.abi);
  add("AI rules", USER, VAULT, v("setAgent", [AGENT, U(0.05), U(1), 0n, true]), "setup");
  add("payee P", USER, VAULT, v("setPayeeRule", [AGENT, P, true, 0n]), "setup");
  add("payee Q", USER, VAULT, v("setPayeeRule", [AGENT, Q, true, 0n]), "setup"); return { st, add }; }
const d3pre = await rpc("eth_simulateV1", [{ blockStateCalls: [{ stateOverrides: ov, calls: [...setup().st.slice(0, 2).map((x) => x.call), { from: RELAYER, to: VAULT, data: digest(Q, U(0.03), n3), gas: "0x4c4b40" }] }], validation: false }, "latest"]);
const d3 = d3pre[0].calls[2].returnData;
const scenarios = [
  (add) => { add("VERSION", RELAYER, VAULT, v("VERSION", []), "read:version");
    add("[1] x402 #1 to P while P has no limit", AGENT, VAULT, v("authorize", [P, U(0.05), 0n, vb, n1, pad("0x01")]), "ok:events");
    add("[1] owner raises P's limit to 0.08", USER, VAULT, v("setPayeeRule", [AGENT, P, true, U(0.08)]), "ok");
    add("[1] direct 0.05 to P (P now at 0.05)", AGENT, VAULT, v("pay", [P, U(0.05), pad("0x02")]), "ok");
    add("[1] release #1", AGENT, VAULT, v("release", [P, U(0.05), 0n, vb, n1]), "ok");
    add("[1] P's remaining", RELAYER, VAULT, v("remainingTodayFor", [AGENT, P]), "read:remP");
    add("[1] direct 0.05 to P is refused (0.10 > 0.08)", AGENT, VAULT, v("pay", [P, U(0.05), pad("0x03")]), "revert:over today's limit for this payee");
    add("P received", RELAYER, USDG, tk("balanceOf", [P]), "read:balP", T); },
  (add) => { add("[3] x402 #2 to Q", AGENT, VAULT, v("authorize", [Q, U(0.02), 0n, vb, n2, pad("0x04")]), "ok");
    add("[3] the same transfer again is refused", AGENT, VAULT, v("authorize", [Q, U(0.02), 0n, vb, n2, pad("0x05")]), "revert:already authorized");
    add("[cap] x402 valid for 2 hours is refused", AGENT, VAULT, v("authorize", [Q, U(0.01), 0n, BigInt(now + 7200), nn("x"), pad("0x06")]), "revert:valid for too long");
    add("[2] owner removes payee Q", USER, VAULT, v("setPayeeRule", [AGENT, Q, false, 0n]), "ok");
    add("[2] settling #2 to removed Q is refused", RELAYER, USDG, settle(Q, U(0.02), n2), "revert:any", T);
    add("[2] owner approves Q again", USER, VAULT, v("setPayeeRule", [AGENT, Q, true, 0n]), "ok");
    add("[r2] settling #2 after re-adding Q stays refused (removal cancelled it for good)", RELAYER, USDG, settle(Q, U(0.02), n2), "revert:any", T);
    add("[r1] same nonce as #2 with another value is refused", AGENT, VAULT, v("authorize", [Q, U(0.01), 0n, vb, n2, pad("0x0a")]), "revert:nonce already used"); },
  (add) => { add("[2] x402 #3 to Q", AGENT, VAULT, v("authorize", [Q, U(0.03), 0n, vb, n3, pad("0x07")]), "ok");
    add("[2] owner revokes the AI", USER, VAULT, v("revoke", [AGENT]), "ok");
    add("[2] settling #3 after revoke is refused", RELAYER, USDG, settle(Q, U(0.03), n3), "revert:any", T);
    add("[6] owner cancels #3 by digest only", USER, VAULT, v("releaseDigest", [d3]), "ok");
    add("[6] #3 cannot be released twice", USER, VAULT, v("releaseDigest", [d3]), "revert:nothing to release");
    add("[r2] owner turns the AI back on", USER, VAULT, v("setAgent", [AGENT, U(0.05), U(1), 0n, true]), "ok");
    add("[r2] x402 #6 to Q", AGENT, VAULT, v("authorize", [Q, U(0.01), 0n, vb, n6, pad("0x0b")]), "ok");
    add("[r2] owner revokes, then turns the AI back on", USER, VAULT, v("revoke", [AGENT]), "ok");
    add("[r2] AI active again", USER, VAULT, v("setAgent", [AGENT, U(0.05), U(1), 0n, true]), "ok");
    add("[r2] settling #6 after revoke + re-activate stays refused", RELAYER, USDG, settle(Q, U(0.01), n6), "revert:any", T);
    add("[r2] a new authorization after re-activating works", AGENT, VAULT, v("authorize", [Q, U(0.01), 0n, vb, n7, pad("0x0c")]), "ok");
    add("[r2] and settles", RELAYER, USDG, settle(Q, U(0.01), n7), "ok", T); },
  (add) => { add("[fz] x402 #4 to Q", AGENT, VAULT, v("authorize", [Q, U(0.04), 0n, vb, n4, pad("0x08")]), "ok");
    add("[fz] owner freezes", USER, VAULT, v("setFrozen", [true]), "ok");
    add("[fz] owner unfreezes", USER, VAULT, v("setFrozen", [false]), "ok");
    add("[fz] settling #4 after freeze + unfreeze is refused", RELAYER, USDG, settle(Q, U(0.04), n4), "revert:any", T);
    add("x402 #5 to Q after unfreeze", AGENT, VAULT, v("authorize", [Q, U(0.05), 0n, vb, n5, pad("0x09")]), "ok");
    add("relayer settles #5", RELAYER, USDG, settle(Q, U(0.05), n5), "ok", T);
    add("Q received", RELAYER, USDG, tk("balanceOf", [Q]), "read:balQ", T); },
];
const all = [];
for (const sc of scenarios) { const { st, add } = setup(); sc(add); let res;
  for (let k = 0; k < 8; k++) { try { res = await rpc("eth_simulateV1", [{ blockStateCalls: [{ stateOverrides: ov, calls: st.map((x) => x.call) }], validation: false }, "latest"]); break; } catch (e) { if (k === 7) throw e; await new Promise((r) => setTimeout(r, 4000)); } }
  st.forEach((x, i) => all.push([x, res[0].calls[i]])); all.blockNo = parseInt(res[0].number, 16); await new Promise((r) => setTimeout(r, 1500)); }
let pass = 0, fail = 0; const reads = {};
all.forEach(([s, r]) => { const ok = r.status === "0x1", rd = r.error?.data || r.returnData;
  if (s.expect === "setup") { if (!ok) { fail++; console.log("  ✗  setup failed: " + s.label); } return; }
  if (s.expect.startsWith("read:")) { reads[s.expect.slice(5)] = r.returnData; return; }
  let why = ""; if (!ok && rd && rd !== "0x") { try { const d = decodeErrorResult({ abi: s.abi === T ? V.abi : s.abi, data: rd }); why = d.errorName + (d.args?.length ? ":" + d.args[0] : ""); } catch { why = "token refused"; } }
  let good = s.expect.startsWith("ok") ? ok : !ok && (s.expect === "revert:any" || why.includes(s.expect.slice(7)));
  if (s.expect === "ok:events") { const names = (r.logs || []).map((l) => { try { return decodeEventLog({ abi: V.abi, data: l.data, topics: l.topics }).eventName; } catch { return "?"; } }); good = good && names.includes("Authorized") && names.includes("AuthorizationNonce"); }
  good ? pass++ : fail++; console.log(`  ${good ? "✓" : "✗"}  ${s.label}${ok ? "" : "  → refused: " + why}`); });
const n = (k) => BigInt(reads[k]);
for (const [l, x] of [["VERSION is 3", n("version") === 3n], ["P's remaining is 0.03 after release", n("remP") === U(0.03)], ["P received 0.05 only", n("balP") === U(0.05)], ["Q received 0.05 only in its scenario (#4 never settled)", n("balQ") === U(0.05)]]) { x ? pass++ : fail++; console.log(`  ${x ? "✓" : "✗"}  ${l}`); }
console.log(`block ${all.blockNo} · ${pass} passed, ${fail} failed`);
