# Allot Split

One address that receives tokens (USDG from x402 payments) and shares them between 2 to 10 fixed payees by fixed shares. Use it as an API's `payTo`.

- **No owner, no admin, no upgrade.** Payees and shares are set at creation and can never change.
- **Pull accounting.** A payee's due amount is `everything ever received × share / total shares − already released`. Anyone may call `release(token, payee)`; the tokens only ever go to that payee. `releaseAll(token)` pays every payee and skips one whose transfer fails.
- **Rounding dust** stays in the contract and is paid out as more arrives.

## Deployed

| Network | Factory | Source |
| --- | --- | --- |
| Robinhood Chain mainnet (4663), beta | `0xebcb983974d378822b34278865b0c176d320918d` | Sourcify exact match |
| Robinhood Chain testnet (46630) | `0x6ec8e0c8ea0397daae9331603b8f4d9da821b12e` | Sourcify exact match |

Mainnet is a beta: the source is verified, the contract is not audited. Start with small amounts.

## Known behaviour, by design

1. **A payee that can never receive keeps its share in the contract forever.** There is no admin who could redirect it, which is the point. The other payees are paid normally (`releaseAll` skips the failing one).
2. **Only plain ERC-20 tokens.** With a fee-on-transfer or rebasing token, a drop in the contract's balance can make `releasable()` revert for that token. Split is meant for USDG and plain ERC-20s.
3. Tokens are accounted per token address. Sending a token by mistake does not affect USDG accounting.

## Tests

`contracts/test/` (Node 18+):

- `compile.cjs`: compiles with solc 0.8.28, optimizer 200 runs, evmVersion cancun (the deployed settings). `EVM=shanghai OUT=build-shanghai.json node compile.cjs` builds the variant used by the local EVM.
- `split.test.mjs`: 71 checks on a local EVM (ganache, shanghai build): creation through the factory, exact 70/20/10 shares, no double pay, rounding dust, a payee that cannot receive, every bad constructor input, and 25 rounds of random shares and payments with exact final amounts.
- `split.simulate.mjs`: the cancun build on the live chain with `eth_simulateV1`, nothing is sent: `node split.simulate.mjs https://rpc.testnet.chain.robinhood.com`.

```
cd contracts/test && npm install
node compile.cjs && EVM=shanghai OUT=build-shanghai.json node compile.cjs
BUILD=build-shanghai.json node split.test.mjs
```
