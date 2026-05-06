# Consuming Wallet Core

This guide documents the current internal wallet-core boundary so another browser ESM app can copy or vendor it without inheriting claim/admin page policy.

## Import

Use the public factory entrypoint:

```js
import { createWalletCore } from "./lib/wallet-core/index.js";
```

Avoid importing from `core/` directly. Those files are the neutral implementation and may move when this folder is promoted into a shared repository.

## Initialize

```js
const walletCore = createWalletCore({
  storage: window.localStorage,
  walletSessionKey: "my-app:wallet-session",
  discoveryWaitMs: 250,
});

walletCore.subscribe((event, data) => {
  // connected, disconnected, accountChanged, chainChanged, providersChanged
});
```

## Connect Flow

```js
await walletCore.discoverWallets();
const wallets = walletCore.getAvailableWallets();

// Render wallets in app UI, then connect only after a user chooses one.
await walletCore.connect({ walletId: wallets[0].id });
```

The core only calls `eth_requestAccounts` during explicit `connect()`.

## Restore Flow

```js
await walletCore.sync();
const state = walletCore.getState();
```

Restore uses the saved wallet id and `eth_accounts`. It does not prompt the wallet during app boot.

## Provider Access

The core exposes the active raw EIP-1193 provider:

```js
const eip1193Provider = walletCore.getEip1193Provider();
```

Wrap this provider in the consuming app or an adapter. For this repo, `frontend/js/lib/wallet-core/adapters/ethers.js` creates an ethers v6 `BrowserProvider` from the ethers module supplied by the app.

## Optional Chain Helper

`frontend/js/lib/wallet-core/adapters/chain.js` exposes low-level helpers for
`wallet_switchEthereumChain`, `wallet_addEthereumChain`, and chain ID hex formatting.
These helpers do not decide when switching is appropriate. The consuming app remains
responsible for required-chain checks, mismatch handling, and write-time network policy.

## App Responsibilities

Keep these outside the neutral core:

- wallet picker UI
- connected-wallet menu UI
- network switching policy
- required-chain checks
- chain add/switch prompts
- contract wiring
- app-specific storage names
- app-specific compatibility rules, such as disabling a wallet for a target network

## This Repo's Adapter

The claim/admin pages consume `frontend/js/shared/wallet-adapter.js` directly so the app
adapter boundary is visible in the integration. `frontend/js/shared/wallet.js` remains as
a compatibility facade for older imports and re-exports the same adapter API.

`wallet-adapter.js` is the repo-local boundary that:

- creates ethers providers from the active EIP-1193 wallet provider
- maps neutral core state into the claim/admin `runtime`
- applies configured-network compatibility rules
- owns wallet network add/switch prompts

## Compatibility Files

Root `discovery.js` and `session.js` currently re-export the neutral `core/` modules for transition safety. New integrations should use `index.js` unless they are intentionally testing internals.

## Shared Repo Readiness

Phase 8 keeps this app consuming local served files, but the wallet-core folder now has
an `EXPORT_MANIFEST.json` and standalone repo README candidate. Run this from the repo
root to produce a clean export copy:

```bash
npm run wallet-core:export
```

The generated `dist/wallet-core/` folder is intentionally ignored by git. It is a
staging artifact for creating or syncing the future shared repository.

## Served Vendor Consumption

Phase 8.5 vendors the exported wallet core into `frontend/vendor/liberdus-wallet-core/`
and points the claim/admin app adapter at that served path. This proves the app can run
against a shared-repo-shaped local copy before an external repository is introduced.

## Consumer Port Readiness

Phase 9 adds `CONSUMER_PORTING.md` and `npm run wallet-core:audit-consumer` so the next
consumer can follow the same adapter-first integration pattern and this repo can verify
that runtime code keeps using the served vendor boundary.
