# Allot Vault v3

Everything in Vault v2 (per-payee daily budgets), plus fixes from outside reviews of v2. None of the v2 issues let an outsider take funds; they were edge cases around pending x402 authorizations.

| Change | Why |
| --- | --- |
| `release()` gives back payee budget only if that authorization charged it | v2 could give back budget that was never charged when a payee's limit was raised while an authorization was pending |
| An authorization stops being valid as soon as its agent is revoked, its key expires or the payee is removed | in v2 a pending authorization could still settle after `revoke()` |
| A freeze cancels every authorization made before it; unfreezing does not revive them | in v2 unfreezing revived pending authorizations |
| The same transfer cannot be authorized twice | v2 charged the budget twice but released once |
| `validBefore` is capped at 1 hour (`MAX_VALIDITY`) | bounds how long an authorization can wait |
| `AuthorizationNonce(digest, validAfter, validBefore, nonce)` event and `releaseDigest(digest)` | the owner can cancel a pending authorization with only its digest |

`VERSION()` returns 3. All v1 and v2 functions and events are unchanged. Not audited: start with small amounts.

## Tests

On Robinhood Chain mainnet state with the real USDG, via `eth_simulateV1`. Nothing is sent.

```
cd contracts/test && npm install
node compile-vault3.cjs
node vault-v3.simulate.mjs   # every fix above: 27 checks
```

The v1 and v2 suites also pass against v3 (19/19, and 29/30 where the only difference is `VERSION` returning 3).
