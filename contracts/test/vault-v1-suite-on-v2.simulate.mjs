// Allot Factory + release() tests on Robinhood Chain mainnet state, against the real USDG, with eth_simulateV1.
// Fresh random test keys only, balances from state overrides, nothing is sent.
import fs from "node:fs";
import { encodeFunctionData, encodeDeployData, decodeErrorResult, getContractAddress, parseAbi, keccak256, encodeAbiParameters, pad, toHex, getAddress, concat } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const RPC = "https://rpc.mainnet.chain.robinhood.com", USDG = getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
const V = JSON.parse(fs.readFileSync(new URL("./build/AllotVault.json", import.meta.url), "utf8")), F = JSON.parse(fs.readFileSync(new URL("./build/AllotFactory.json", import.meta.url), "utf8"));
const T = parseAbi(["function balanceOf(address) view returns (uint256)", "function DOMAIN_SEPARATOR() view returns (bytes32)", "function authorizationState(address,bytes32) view returns (bool)",
  "function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,bytes signature)"]);
const rpc = async (m, p) => { for (let k = 0; k < 12; k++) { const j = await (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: m, params: p }) })).json(); if (j.error && j.error.code === 429) { await new Promise((r) => setTimeout(r, 6000 + 3000 * k)); continue; } if (j.error) throw new Error(JSON.stringify(j.error)); return j.result; } throw new Error("rate limited"); };
const acct = () => privateKeyToAccount(generatePrivateKey()).address;
const DEPLOYER = acct(), USER = acct(), AGENT = acct(), PAYEE = acct(), STRANGER = acct(), RELAYER = acct();
const DS = await rpc("eth_call", [{ to: USDG, data: encodeFunctionData({ abi: T, functionName: "DOMAIN_SEPARATOR" }) }, "latest"]);
const FACTORY = getContractAddress({ from: DEPLOYER, nonce: 0n });
const vaultInit = encodeDeployData({ abi: V.abi, bytecode: V.bytecode, args: [USER, USDG, DS] });
const VAULT = getContractAddress({ opcode: "CREATE2", from: FACTORY, salt: keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [USER, 0n])), bytecode: vaultInit });
const balSlot = (a) => keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [a, 1n]));
const U = (x) => BigInt(Math.round(x * 1e6)), ETH = "0x8ac7230489e80000";
const steps = [], add = (label, from, to, data, expect, abi = V.abi) => steps.push({ label, call: { from, to, data, gas: "0x30d40" }, expect, abi });
const v = (fn, a) => encodeFunctionData({ abi: V.abi, functionName: fn, args: a }), tk = (fn, a) => encodeFunctionData({ abi: T, functionName: fn, args: a });
const now = BigInt(Math.floor(Date.now() / 1000)), vb = now + 300n, n1 = keccak256(toHex("r1" + Math.random())), n2 = keccak256(toHex("r2" + Math.random()));

steps.push({ label: "deploy factory", call: { from: DEPLOYER, data: encodeDeployData({ abi: F.abi, bytecode: F.bytecode, args: [USDG, DS] }), gas: "0x4c4b40" }, expect: "ok", abi: F.abi });
add("user creates a vault with one call", USER, FACTORY, encodeFunctionData({ abi: F.abi, functionName: "create" }), "ok", F.abi);
steps.at(-1).call.gas = "0x2dc6c0";
add("factory lists the user's vault", RELAYER, FACTORY, encodeFunctionData({ abi: F.abi, functionName: "vaultsOf", args: [USER] }), "read:list", F.abi);
add("vault owner is the user", RELAYER, VAULT, v("owner", []), "read:owner");
add("stranger tries to set an agent on the user's vault", STRANGER, VAULT, v("setAgent", [STRANGER, U(5), U(5), 0n, true]), "revert:NotOwner");
add("user adds an AI: 0.05 per payment, 0.10 per day", USER, VAULT, v("setAgent", [AGENT, U(0.05), U(0.1), 0n, true]), "ok");
add("user approves a payee", USER, VAULT, v("setPayee", [AGENT, PAYEE, true]), "ok");
add("AI authorizes x402 #1 for 0.05", AGENT, VAULT, v("authorize", [PAYEE, U(0.05), 0n, vb, n1, pad("0x01")]), "ok");
add("AI authorizes x402 #2 for 0.05 (daily x402 limit now full)", AGENT, VAULT, v("authorize", [PAYEE, U(0.05), 0n, vb, n2, pad("0x02")]), "ok");
add("AI tries a direct 0.01 payment (limit full)", AGENT, VAULT, v("pay", [PAYEE, U(0.01), pad("0x03")]), "revert:over today's x402 limit");
add("stranger tries to release #1", STRANGER, VAULT, v("release", [PAYEE, U(0.05), 0n, vb, n1]), "revert:not yours to release");
add("API never charged #1: AI releases it", AGENT, VAULT, v("release", [PAYEE, U(0.05), 0n, vb, n1]), "ok");
add("relayer tries to settle the released #1", RELAYER, USDG, tk("transferWithAuthorization", [VAULT, PAYEE, U(0.05), 0n, vb, n1, "0x"]), "revert:any", T);
add("limit came back: AI pays 0.01 directly", AGENT, VAULT, v("pay", [PAYEE, U(0.01), pad("0x04")]), "ok");
add("relayer settles #2", RELAYER, USDG, tk("transferWithAuthorization", [VAULT, PAYEE, U(0.05), 0n, vb, n2, "0x"]), "ok", T);
add("owner tries to release the settled #2", USER, VAULT, v("release", [PAYEE, U(0.05), 0n, vb, n2]), "revert:already settled");
add("payee received", RELAYER, USDG, tk("balanceOf", [PAYEE]), "read:payee", T);
add("user withdraws the rest", USER, VAULT, v("withdraw", [USER, U(4.94)]), "ok");
add("vault balance after withdraw", RELAYER, USDG, tk("balanceOf", [VAULT]), "read:vault", T);

const ov = { [USDG]: { stateDiff: { [balSlot(VAULT)]: pad(toHex(U(5))) } } }; for (const a of [DEPLOYER, USER, AGENT, STRANGER, RELAYER]) ov[a] = { balance: ETH };
const res = await rpc("eth_simulateV1", [{ blockStateCalls: [{ stateOverrides: ov, calls: steps.map((s) => s.call) }], validation: false }, "latest"]);
let pass = 0, fail = 0; const reads = {};
console.log(`Robinhood Chain mainnet state · block ${parseInt(res[0].number, 16).toLocaleString("en-US")}\nfactory ${FACTORY}\nvault   ${VAULT}`);
res[0].calls.forEach((r, i) => { const s = steps[i], ok = r.status === "0x1", rd = r.error?.data || r.returnData;
  if (s.expect.startsWith("read:")) { reads[s.expect.slice(5)] = r.returnData; return; }
  let why = ""; if (!ok && rd && rd !== "0x") { try { const d = decodeErrorResult({ abi: s.abi === T ? V.abi : s.abi, data: rd }); why = d.errorName + (d.args?.length ? ":" + d.args[0] : ""); } catch { why = "token refused"; } }
  const good = s.expect === "ok" ? ok : !ok && (s.expect === "revert:any" || why.includes(s.expect.slice(7))); good ? pass++ : fail++;
  console.log(`  ${good ? "✓" : "✗"}  ${s.label}${ok ? "" : "  → refused: " + why}`); });
const listed = reads.list?.toLowerCase().includes(VAULT.slice(2).toLowerCase()), owner = "0x" + reads.owner.slice(-40), payee = BigInt(reads.payee), vault = BigInt(reads.vault);
const extra = [["factory lists the vault", listed], ["vault owner is the user", getAddress(owner) === USER], ["payee got 0.06 (0.01 direct + 0.05 x402)", payee === U(0.06)], ["vault empty after withdraw", vault === 0n]];
for (const [l, x] of extra) { x ? pass++ : fail++; console.log(`  ${x ? "✓" : "✗"}  ${l}`); }
console.log(`${pass} passed, ${fail} failed`);
