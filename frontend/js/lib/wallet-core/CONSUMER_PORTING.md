# Consumer Porting Guide

This guide is the Phase 9 handoff checklist for bringing another browser ESM app onto
the shared wallet core after its own wallet/network behavior has been decoupled.

## When A Consumer Is Ready

A consumer app is ready to adopt the shared wallet core when:

- wallet connection/session state is separate from network write policy
- the app can keep its own wallet picker and connected-wallet menu
- required-chain checks live in app code
- contract clients are created outside the neutral wallet core
- the app can provide a storage key rather than relying on shared defaults
- the app can provide its own ethers import or equivalent client adapter

Do not port a consumer while its wallet connection code still owns swap/claim network
policy as one mixed module. That would push app-specific rules into the shared core.

## Target Integration Shape

```text
consumer page/component
  -> consumer wallet adapter
    -> vendor/liberdus-wallet-core/index.js
    -> vendor/liberdus-wallet-core/adapters/chain.js
    -> optional client-library adapter
```

The consumer adapter should own:

- app storage keys
- wallet compatibility rules
- chain mismatch UX
- when network switching is allowed
- signer/provider rebinding
- app event names or state framework bindings

The shared core should own only:

- wallet discovery
- wallet selection
- connect/disconnect
- silent restore
- active EIP-1193 provider access
- neutral wallet lifecycle events

## Minimal Consumer Adapter Sketch

```js
import { createWalletCore } from "./vendor/liberdus-wallet-core/index.js";
import { switchOrAddEthereumChain } from "./vendor/liberdus-wallet-core/adapters/chain.js";
import { createBrowserProvider } from "./vendor/liberdus-wallet-core/adapters/ethers.js";
import { ethers } from "./app/ethers.js";

const walletCore = createWalletCore({
  storage: window.localStorage,
  walletSessionKey: "consumer:wallet-session",
});

export async function connectWallet(walletId) {
  await walletCore.discoverWallets();
  await walletCore.connect({ walletId });
  return walletCore.getState();
}

export function getProvider() {
  const eip1193Provider = walletCore.getEip1193Provider();
  return createBrowserProvider(eip1193Provider, ethers);
}

export async function switchForWrite(chainConfig) {
  const eip1193Provider = walletCore.getEip1193Provider();
  await switchOrAddEthereumChain(eip1193Provider, chainConfig);
}
```

## Porting Steps

1. Copy or sync `frontend/vendor/liberdus-wallet-core/` into the consumer app served tree.
2. Build a consumer-local wallet adapter instead of importing the core directly from UI code.
3. Pass a consumer-specific `walletSessionKey`.
4. Keep the existing consumer wallet picker UI and feed it `walletCore.getAvailableWallets()`.
5. Recreate provider/signer objects in the consumer adapter.
6. Move only low-level chain add/switch calls to `adapters/chain.js`; keep policy local.
7. Run the consumer app's existing connect, restore, disconnect, wrong-network, and write-flow tests.

## Required Consumer Tests

At minimum, the consumer should prove:

- selected-wallet connect works with an EIP-6963 wallet
- legacy `window.ethereum` fallback still works
- silent restore does not prompt the wallet
- explicit disconnect prevents silent restore
- chain change updates wallet state without forcing app policy decisions into the core
- wrong-network users remain connected if that is the consumer's existing behavior
- write-time network switching still happens where the consumer expects it
- the consumer can use its preferred ethers/client-library import

## Non-Goals For Phase 9

Phase 9 should not:

- remove compatibility shims from this repo
- move claim/admin policy into `wallet-core`
- force npm package runtime consumption
- rewrite another app's wallet UI
- standardize all Liberdus apps on one provider/signer facade before they are ready
