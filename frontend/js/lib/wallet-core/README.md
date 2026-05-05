# Wallet Core

This folder contains a neutral injected wallet discovery and session core intended for reuse across browser ESM apps.

## Folder shape

```text
wallet-core/
  index.js              Public core factory
  core/                 Neutral discovery and session implementation
  adapters/             Optional app/client-library adapters
  discovery.js          Compatibility re-export
  session.js            Compatibility re-export
  EXPORT_MANIFEST.json  Files and boundaries for future repo extraction
```

Apps should import the public factory from `index.js`. The `core/` files are kept UI-free and app-policy-free so they can later move into a shared repository with minimal logic changes.
Use `npm run wallet-core:export` from the repo root to generate an export-ready copy under `dist/wallet-core/`.

## What it provides

- injected wallet discovery via EIP-6963 and legacy `window.ethereum`
- wallet listing by stable `walletId`
- explicit wallet selection + `eth_requestAccounts`
- session restore via `eth_accounts`
- disconnect behavior
- chain ID state and event subscription
- raw EIP-1193 provider access

## Usage

```js
import { createWalletCore } from "./lib/wallet-core/index.js";

const walletCore = createWalletCore({
  storage: window.localStorage,
  walletSessionKey: "my-app:walletSession",
});

await walletCore.discoverWallets();
const wallets = walletCore.getAvailableWallets();
await walletCore.connect({ walletId: wallets[0].id });
```

## App adapter pattern

Apps should keep UI and network policy separate from the core.
This repo uses `frontend/js/shared/wallet-adapter.js` as the claim/admin app adapter.
Claim/admin pages import this adapter directly. `frontend/js/shared/wallet.js` remains a
compatibility facade for older imports.
The app adapter:

- creates an ethers provider from the raw injected provider
- maps core state into the app `runtime`
- discovers wallets before rendering wallet selection so UI prompts have a current wallet list
- applies claim/admin wallet compatibility policy, such as disabling Phantom for configured BNB networks
- keeps network switching and contract wiring in app code

## Notes

- The core does not depend on ethers.
- Ethers-specific provider creation belongs in an adapter and receives ethers from the consuming app.
- Low-level chain add/switch RPC helpers live in `adapters/chain.js`, but apps decide when to call them.
- Wallet compatibility and network policy belong in the app adapter, not the neutral core.
- The core is browser-first and expects a browser-compatible storage object.
- Root `discovery.js` and `session.js` are compatibility re-exports; new integrations should prefer `index.js`.
