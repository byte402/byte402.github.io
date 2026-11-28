// Allot Split (testnet). Every write: build the transaction -> eth_simulateV1 on Robinhood Chain Testnet -> show
// the result -> the wallet owner signs. Test USDG has no value. Nothing here touches mainnet.
(() => {
  const E = window.ethers, $ = (id) => document.getElementById(id);
  let CFG = null, ABI = null, ACCT = null, OPEN = null;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);
  const fmt = (raw) => (Number(raw) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 });
  const log = (id, t) => { $(id).textContent = t; };
  const exa = (a) => `<a href="${CFG.explorer}/address/${a}" target="_blank" rel="noopener">${short(a)} ↗</a>`;
  const ext = (h) => `<a href="${CFG.explorer}/tx/${h}" target="_blank" rel="noopener">${short(h)} ↗</a>`;
  const CHAIN = () => "0x" + CFG.chainId.toString(16);
  async function rpc(method, params) {
    for (let k = 0; k < 6; k++) {
      const j = await (await fetch(CFG.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json();
      if (j.error && j.error.code === 429) { await sleep(2000 * (k + 1)); continue; }
      if (j.error) throw Object.assign(new Error(j.error.message), { data: j.error.data }); return j.result;
    } throw new Error("Robinhood Chain Testnet RPC is busy, try again in a minute");
  }
  const I = (n) => new E.Interface(ABI[n].abi);
  async function read(to, n, fn, args = []) { const i = I(n); return i.decodeFunctionResult(fn, await rpc("eth_call", [{ to, data: i.encodeFunctionData(fn, args) }, "latest"])); }
  function why(data) {
    if (!data || data === "0x") return "the transaction would fail";
    for (const n of ["AllotSplit", "AllotSplitFactory", "TestUSDG"]) { try { const d = I(n).parseError(data); if (d) return d.args.length ? d.args[0] : d.name; } catch {} }
    try { return E.AbiCoder.defaultAbiCoder().decode(["string"], "0x" + data.slice(10))[0]; } catch {}
    return "the transaction would fail";
  }
  async function simulate(from, call) {
    const c = { from, data: call.data, value: "0x0", gas: "0x1c9c380" }; if (call.to) c.to = call.to;
    const r = (await rpc("eth_simulateV1", [{ blockStateCalls: [{ calls: [c] }], validation: false }, "latest"]))[0].calls[0];
    return { ok: r.status === "0x1", gas: parseInt(r.gasUsed, 16), why: r.status === "0x1" ? "" : why(r.error?.data || r.returnData), ret: r.returnData };
  }
  const wallet = () => window.okxwallet || window.ethereum;
  async function connect() {
    const w = wallet(); if (!w) throw new Error("No wallet found. Open this page in a browser with OKX Wallet or MetaMask.");
    const [a] = await w.request({ method: "eth_requestAccounts" });
    try { await w.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN() }] }); }
    catch (e) { if (e.code === 4902) await w.request({ method: "wallet_addEthereumChain", params: [{ chainId: CHAIN(), chainName: CFG.network, rpcUrls: [CFG.rpc], nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, blockExplorerUrls: [CFG.explorer] }] }); else throw e; }
    const cid = await w.request({ method: "eth_chainId" }); if (parseInt(cid, 16) !== CFG.chainId) throw new Error("Your wallet is not on " + CFG.network + ". Switch network and try again.");
    return E.getAddress(a);
  }
  // simulate, then the wallet signs; resolves with the receipt
  async function write(logId, label, call) {
    if (!ACCT) ACCT = await connect().then(showAcct); else if (parseInt(await wallet().request({ method: "eth_chainId" }), 16) !== CFG.chainId) ACCT = await connect();
    log(logId, label + ": simulating on " + CFG.network + "…");
    const s = await simulate(ACCT, call); if (!s.ok) throw new Error("Simulation says it would fail: " + s.why + ". Nothing was sent.");
    log(logId, label + ": simulation OK (" + s.gas.toLocaleString("en-US") + " gas). Confirm in your wallet. Check that it says " + CFG.network + ".");
    const tx = { from: ACCT, data: call.data, value: "0x0", gas: "0x" + Math.ceil(s.gas * 1.3 + 30000).toString(16) }; if (call.to) tx.to = call.to;
    const hash = await wallet().request({ method: "eth_sendTransaction", params: [tx] });
    log(logId, label + ": sent " + hash + ", waiting for the block…");
    for (let i = 0; i < 80; i++) { await sleep(1500); const rc = await rpc("eth_getTransactionReceipt", [hash]); if (rc) { if (rc.status !== "0x1") throw new Error("The transaction failed on chain: " + hash); return { hash, rc, sim: s }; } }
    throw new Error("Still waiting for the block. Check the explorer: " + hash);
  }
  function showAcct(a) { $("acct").hidden = false; $("acct").textContent = short(a); $("connect").hidden = true; listMine(a); return a; }
  const fail = (id) => (e) => log(id, "✕ " + (e.shortMessage || e.message || String(e)).replace(/^Error: /, ""));

  // ---------- one-time setup: deploy Test USDG and the factory ----------
  function setupState() {
    const ready = E.isAddress(CFG.token) && E.isAddress(CFG.factory);
    $("setup").hidden = ready; $("main").hidden = !ready;
    if (ready) { $("facts").innerHTML = `Network <b>${CFG.network}</b> (chain ${CFG.chainId}) · Factory ${exa(CFG.factory)} · Test USDG ${exa(CFG.token)} <span class="muted">(no value)</span>`; }
  }
  $("dTok").onclick = () => write("setupLog", "Deploy Test USDG", { data: ABI.TestUSDG.bytecode }).then((r) => { $("outTok").textContent = r.rc.contractAddress; log("setupLog", "✓ Test USDG deployed at " + r.rc.contractAddress + " in " + r.hash + ". Now deploy the factory."); }).catch(fail("setupLog"));
  $("dFac").onclick = () => write("setupLog", "Deploy Split factory", { data: ABI.AllotSplitFactory.bytecode }).then((r) => { $("outFac").textContent = r.rc.contractAddress; $("outBlk").textContent = parseInt(r.rc.blockNumber, 16); log("setupLog", "✓ Factory deployed at " + r.rc.contractAddress + " in block " + parseInt(r.rc.blockNumber, 16) + ". Send both addresses to the Allot team to switch this page on."); }).catch(fail("setupLog"));

  // ---------- create a split ----------
  function addRow(addr = "", pct = "") {
    if ($("rows").children.length >= 10) return;
    const d = document.createElement("div"); d.className = "prow";
    d.innerHTML = `<input class="pa" placeholder="0x… payee address" spellcheck="false" value="${addr}"><input class="ps" inputmode="decimal" placeholder="%" value="${pct}"><button type="button" class="rm" aria-label="Remove payee">×</button>`;
    d.querySelector(".rm").onclick = () => { if ($("rows").children.length > 2) { d.remove(); total(); } };
    d.querySelectorAll("input").forEach((i) => (i.oninput = total)); $("rows").appendChild(d); total();
  }
  function parsed() {
    const rows = [...$("rows").children].map((d) => ({ a: d.querySelector(".pa").value.trim(), p: d.querySelector(".ps").value.trim() }));
    const bps = rows.map((r) => Math.round(parseFloat(r.p) * 100)); return { rows, bps, sum: bps.reduce((s, x) => s + (isFinite(x) ? x : 0), 0) };
  }
  function total() { const { sum } = parsed(); $("sum").textContent = (sum / 100).toFixed(2) + "% of 100%"; $("sum").className = sum === 10000 ? "ok" : "no"; }
  $("addRow").onclick = () => addRow();
  $("mineFill").onclick = async () => { try { if (!ACCT) ACCT = await connect().then(showAcct); const f = $("rows").querySelector(".pa"); f.value = ACCT; } catch (e) { fail("createLog")(e); } };
  $("create").onclick = async () => {
    try {
      const { rows, bps, sum } = parsed();
      for (const r of rows) if (!E.isAddress(r.a)) throw new Error("Not an address: " + (r.a || "(empty)"));
      if (new Set(rows.map((r) => r.a.toLowerCase())).size !== rows.length) throw new Error("Each payee can be listed only once");
      if (bps.some((x) => !isFinite(x) || x <= 0)) throw new Error("Every share must be more than 0%, with up to 2 decimals");
      if (sum !== 10000) throw new Error("Shares must add up to exactly 100%. Now: " + (sum / 100).toFixed(2) + "%");
      const data = I("AllotSplitFactory").encodeFunctionData("create", [rows.map((r) => E.getAddress(r.a)), bps]);
      const r = await write("createLog", "Create Split", { to: CFG.factory, data });
      const ev = r.rc.logs.map((l) => { try { return I("AllotSplitFactory").parseLog(l); } catch { return null; } }).find((x) => x && x.name === "SplitCreated");
      log("createLog", "✓ Split created at " + ev.args.split + " in " + r.hash + ". It can never be changed."); open(ev.args.split); listMine(ACCT);
    } catch (e) { fail("createLog")(e); }
  };

  // ---------- my splits / open a split ----------
  async function listMine(a) {
    try { const [list] = await read(CFG.factory, "AllotSplitFactory", "splitsOf", [a]);
      $("mine").innerHTML = list.length ? list.slice().reverse().map((s) => `<button type="button" class="chip" data-s="${s}">${short(s)}</button>`).join("") : '<span class="muted">No Splits created from this wallet yet.</span>';
      $("mine").querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => open(b.dataset.s)));
    } catch {}
  }
  $("openBtn").onclick = () => { const v = $("openAddr").value.trim(); if (E.isAddress(v)) open(v); else log("splitLog", "✕ Paste a Split address (0x…)."); };
  async function open(addr) {
    OPEN = E.getAddress(addr); history.replaceState(null, "", location.pathname + "?s=" + OPEN); $("split").hidden = false; $("sAddr").innerHTML = exa(OPEN); log("splitLog", "Reading the Split…");
    try {
      const code = await rpc("eth_getCode", [OPEN, "latest"]); if (code === "0x") throw new Error("No contract at this address on " + CFG.network);
      const [payees] = await read(OPEN, "AllotSplit", "payees"), [tot] = await read(OPEN, "AllotSplit", "totalShares");
      const tk = CFG.token, [bal] = await read(tk, "TestUSDG", "balanceOf", [OPEN]), [rel] = await read(OPEN, "AllotSplit", "totalReleased", [tk]);
      const rows = await Promise.all(payees.map(async (p) => { const [[sh], [got], [due], [wb]] = await Promise.all([read(OPEN, "AllotSplit", "shares", [p]), read(OPEN, "AllotSplit", "released", [tk, p]), read(OPEN, "AllotSplit", "releasable", [tk, p]), read(tk, "TestUSDG", "balanceOf", [p])]); return { p, sh, got, due, wb }; }));
      $("sRecv").textContent = fmt(bal + rel) + " tUSDG"; $("sHeld").textContent = fmt(bal) + " tUSDG"; $("sRel").textContent = fmt(rel) + " tUSDG"; $("sN").textContent = payees.length;
      $("ptab").innerHTML = "<tr><th>PAYEE</th><th>SHARE</th><th>PAID OUT</th><th>READY TO RELEASE</th><th></th></tr>" + rows.map((r) => `<tr><td>${exa(r.p)}${ACCT && r.p.toLowerCase() === ACCT.toLowerCase() ? ' <span class="muted">you</span>' : ""}</td><td>${(Number(r.sh) * 100 / Number(tot)).toFixed(2)}%</td><td>${fmt(r.got)}</td><td>${fmt(r.due)}</td><td><button type="button" class="rel" data-p="${r.p}" ${r.due === 0n ? "disabled" : ""}>Release</button></td></tr>`).join("");
      $("ptab").querySelectorAll(".rel").forEach((b) => (b.onclick = () => write("splitLog", "Release to " + short(b.dataset.p), { to: OPEN, data: I("AllotSplit").encodeFunctionData("release", [tk, b.dataset.p]) }).then((r) => { log("splitLog", "✓ Released in " + r.hash); open(OPEN); }).catch(fail("splitLog"))));
      const evs = await rpc("eth_getLogs", [{ address: OPEN, fromBlock: "0x" + Number(CFG.factoryBlock).toString(16), toBlock: "latest" }]);
      const rl = evs.map((l) => { try { return { ...I("AllotSplit").parseLog(l), h: l.transactionHash }; } catch { return null; } }).filter((x) => x && x.name === "Released").slice(-12).reverse();
      $("sAct").innerHTML = rl.length ? rl.map((x) => `<div>${fmt(x.args.amount)} tUSDG → ${short(x.args.payee)} · ${ext(x.h)}</div>`).join("") : '<span class="muted">No releases yet.</span>';
      log("splitLog", "Read live from " + CFG.network + " · " + new Date().toUTCString().slice(17, 25) + " UTC");
    } catch (e) { fail("splitLog")(e); }
  }
  $("pay").onclick = () => { let v; try { v = E.parseUnits(($("payAmt").value || "0").trim(), 6); } catch { return log("splitLog", "✕ Enter an amount like 1.00"); } if (v <= 0n) return log("splitLog", "✕ Enter an amount above 0");
    write("splitLog", "Mint test USDG into the Split", { to: CFG.token, data: I("TestUSDG").encodeFunctionData("mint", [OPEN, v]) }).then((r) => { log("splitLog", "✓ " + fmt(v) + " tUSDG arrived in the Split, like a payment would: " + r.hash); open(OPEN); }).catch(fail("splitLog")); };
  $("relAll").onclick = () => write("splitLog", "Release to every payee", { to: OPEN, data: I("AllotSplit").encodeFunctionData("releaseAll", [CFG.token]) }).then((r) => { log("splitLog", "✓ Released to every payee in " + r.hash); open(OPEN); }).catch(fail("splitLog"));
  $("refresh").onclick = () => OPEN && open(OPEN);
  $("connect").onclick = () => connect().then((a) => { ACCT = showAcct(a); }).catch((e) => alert(e.message));

  (async () => {
    try { [CFG, ABI] = await Promise.all([fetch("split-config.json?t=" + Date.now(), { cache: "no-store" }).then((r) => r.json()), fetch("split-build.json").then((r) => r.json())]); }
    catch (e) { document.querySelector("main").insertAdjacentHTML("beforeend", '<p class="log">Could not load the page settings.</p>'); return; }
    setupState(); addRow(); addRow(); const s = new URLSearchParams(location.search).get("s"); if (s && E.isAddress(s) && !$("main").hidden) open(s);
  })();
})();
