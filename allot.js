// Allot shared helpers: Robinhood Chain RPC, wallet connection, simulate-then-send.
// Every write is: build the transaction → eth_simulateV1 on mainnet → show the result → the wallet owner signs.
const ALLOT = (() => {
  // ?net=testnet runs the same app on Robinhood Chain Testnet with Test USDG (no value). Mainnet is the default.
  const NETS = {
    mainnet: { RPC: "https://rpc.mainnet.chain.robinhood.com", CHAIN: "0x1237", EXP: "https://robinhoodchain.blockscout.com", USDG: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", NAME: "Robinhood Chain mainnet", CHAIN_NAME: "Robinhood Chain", CFG: "config.json", TOKEN: "USDG" },
    testnet: { RPC: "https://rpc.testnet.chain.robinhood.com", CHAIN: "0xb626", EXP: "https://explorer.testnet.chain.robinhood.com", USDG: "0xd6107bA338c8b3b754D2bC0D6873A11352359E75", NAME: "Robinhood Chain Testnet", CHAIN_NAME: "Robinhood Chain Testnet", CFG: "config-testnet.json", TOKEN: "Test USDG" },
  };
  const NET = new URLSearchParams(location.search).get("net") === "testnet" ? "testnet" : "mainnet", N = NETS[NET];
  const RPC = N.RPC, CHAIN = N.CHAIN, EXP = N.EXP;
  const USDG = N.USDG; // USDG on Robinhood Chain (Test USDG on testnet); its DOMAIN_SEPARATOR is always read live
  const E = window.ethers;
  let abi = null, cfg = null;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function rpc(method, params) {
    for (let k = 0; k < 6; k++) {
      const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      const j = await r.json(); if (j.error && j.error.code === 429) { await sleep(2500 * (k + 1)); continue; }
      if (j.error) throw Object.assign(new Error(j.error.message), { data: j.error.data }); return j.result;
    } throw new Error("Robinhood Chain RPC is busy, try again in a minute");
  }
  async function load() {
    if (!abi) abi = await (await fetch("allot-abi.json")).json();
    if (!cfg) cfg = await (await fetch(N.CFG + "?t=" + Date.now(), { cache: "no-store" })).json();
    return { abi, cfg };
  }
  const iface = (kind) => new E.Interface(kind === "factory" ? abi.factory : kind === "vault" ? abi.vault : ["function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)", "function DOMAIN_SEPARATOR() view returns (bytes32)"]);
  async function read(to, kind, fn, args = []) { const i = iface(kind); const out = await rpc("eth_call", [{ to, data: i.encodeFunctionData(fn, args) }, "latest"]); return i.decodeFunctionResult(fn, out); }
  const wallet = () => window.okxwallet || window.ethereum;
  async function connect() {
    const w = wallet(); if (!w) throw new Error("No wallet found. Open this page in a browser with OKX Wallet or MetaMask.");
    const [a] = await w.request({ method: "eth_requestAccounts" });
    try { await w.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN }] }); }
    catch (e) { if (e.code === 4902) await w.request({ method: "wallet_addEthereumChain", params: [{ chainId: CHAIN, chainName: N.CHAIN_NAME, rpcUrls: [RPC], nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, blockExplorerUrls: [EXP] }] }); else throw e; }
    if (parseInt(await w.request({ method: "eth_chainId" }), 16) !== parseInt(CHAIN, 16)) throw new Error("Your wallet is not on " + N.CHAIN_NAME + ". Switch network and try again.");
    return E.getAddress(a);
  }
  function decodeErr(data) {
    if (!data || data === "0x") return "the transaction would fail";
    try { const i = iface("vault"), d = i.parseError(data); return d.args.length ? d.args[0] : d.name; } catch {}
    try { return E.AbiCoder.defaultAbiCoder().decode(["string"], "0x" + data.slice(10))[0]; } catch {}
    return "the transaction would fail";
  }
  // simulate a list of calls in order on the chain state; returns per-call {ok, gas, why, ret}
  async function simulate(from, calls) {
    const res = await rpc("eth_simulateV1", [{ blockStateCalls: [{ calls: calls.map((c) => ({ from, to: c.to, data: c.data, value: c.value || "0x0", gas: c.gas || "0x2dc6c0" })) }], validation: false }, "latest"]);
    return res[0].calls.map((r) => ({ ok: r.status === "0x1", gas: parseInt(r.gasUsed, 16), why: r.status === "0x1" ? "" : decodeErr(r.error?.data || r.returnData), ret: r.returnData, logs: r.logs }));
  }
  async function send(from, call, gasUsed) {
    const hash = await wallet().request({ method: "eth_sendTransaction", params: [{ from, to: call.to, data: call.data, value: call.value || "0x0", gas: "0x" + Math.ceil(gasUsed * 1.3 + 20000).toString(16) }] });
    for (let i = 0; i < 80; i++) { await sleep(1500); const rc = await rpc("eth_getTransactionReceipt", [hash]); if (rc) { if (rc.status !== "0x1") throw new Error("The transaction failed on chain"); return { hash, rc }; } }
    throw new Error("Still waiting for the block. Check the explorer: " + hash);
  }
  const fmt = (raw, d = 6) => (Number(raw) / 10 ** d).toLocaleString("en-US", { maximumFractionDigits: 4 });
  const units = (x, d = 6) => E.parseUnits(String(x || "0").trim() || "0", d);
  const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);
  return { NET, NAME: N.NAME, TOKEN: N.TOKEN, RPC, CHAIN, EXP, USDG, rpc, load, iface, read, connect, simulate, send, fmt, units, short, wallet, E };
})();
