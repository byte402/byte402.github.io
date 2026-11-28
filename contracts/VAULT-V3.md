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
| Revoking an agent or removing one of its payees cancels all its pending authorizations for good; re-activating does not revive them | second review: in the first v3 testnet build, re-adding brought them back until `validBefore` |
| Each EIP-3009 nonce can be authorized only once, whatever the value | second review: two authorizations with the same nonce both charged the budget while only one could settle |

Note: removing any payee from an agent cancels all of that agent's pending authorizations, not only those to that payee. Stricter on purpose.

Note: `ref` in `Authorized` and `Paid` is supplied by the agent (Allot's connector uses keccak256 of the URL). Treat it as a label, not as proof.

Deployed: mainnet factory `0x76b4ee58245e45c7b4c73ab1ab01896623268d62` (block 125137202), testnet factory `0xebcb983974d378822b34278865b0c176d320918d`. Both verified on Sourcify, exact match.

`VERSION()` returns 3. All v1 and v2 functions and events are unchanged. Not audited: start with small amounts.

## Tests

On Robinhood Chain mainnet state with the real USDG, via `eth_simulateV1`. Nothing is sent.

```
cd contracts/test && npm install
node compile-vault3.cjs
node vault-v3.simulate.mjs   # every fix above: 35 checks
```

The v1 and v2 suites also pass against v3 (19/19, and 29/30 where the only difference is `VERSION` returning 3).
