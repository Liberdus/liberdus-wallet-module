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

Wrap this provider in the consuming app or an adapter. For this repo, `frontend/js/lib/wallet-core/adapters/ethers.js` creates an ethers v6 `BrowserProvider`.

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

## Compatibility Files

Root `discovery.js` and `session.js` currently re-export the neutral `core/` modules for transition safety. New integrations should use `index.js` unless they are intentionally testing internals.
