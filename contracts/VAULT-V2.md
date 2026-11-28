# Allot Vault v2

Everything Allot Vault v1 does, plus an optional **daily budget for each payee** (per provider), on top of the agent's own cap per payment and daily budget.

- `setPayeeRule(agent, payee, allowed, perDay)`: approve or remove a payee and set its daily budget in one call. `perDay = 0` means no extra limit (v1 behaviour). Emits `PayeeSet` and `PayeeLimitSet`.
- A payment passes only if it is under the agent's cap per payment, inside the agent's daily budget **and** inside that payee's daily budget. Days are UTC days, as in v1.
- `release()` of an unsettled x402 authorization gives the amount back to both budgets on the same UTC day.
- `remainingTodayFor(agent, payee)`: what the agent can still pay that payee today (the smaller of the two budgets, 0 if the payee is not approved).
- `VERSION()` returns 2. All v1 functions and events are unchanged, so the connector, the Ledger and Receipts work with v2 vaults as they are.

No owner besides the vault owner, no upgrade path, not audited. Start with small amounts.

## Tests

On Robinhood Chain mainnet state with the real USDG, via `eth_simulateV1`. Nothing is sent, keys are fresh random test keys.

```
cd contracts/test && npm install
node compile-vault.cjs
node vault-v1-suite-on-v2.simulate.mjs   # the full v1 suite against v2: 19 checks
node vault-v2.simulate.mjs               # per-payee budgets, release, removal, next UTC day: 30 checks
```
