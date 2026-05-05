# Liberdus Wallet Core

Browser-first ESM wallet discovery and session core for Liberdus apps.

This is the standalone repo README candidate for the future shared wallet-core
repository. It intentionally documents the shared boundary, not the claim/admin app.

## Responsibilities

This package owns:

- injected wallet discovery through EIP-6963 and legacy `window.ethereum`
- stable wallet descriptors and wallet lookup by id
- explicit connect by wallet id
- silent restore with `eth_accounts`
- disconnect/session clearing
- active account, chain id, selected wallet metadata, and provider state
- neutral lifecycle events through `subscribe()`
- raw EIP-1193 provider access
- optional low-level adapters for ethers and wallet add/switch chain RPCs

This package does not own:

- wallet picker UI
- connected wallet menu UI
- required-chain policy
- transaction gating
- contract wiring
- app-specific storage keys
- app-specific wallet compatibility rules

## Browser ESM Usage

```js
import { createWalletCore } from "./wallet-core/index.js";

const walletCore = createWalletCore({
  storage: window.localStorage,
  walletSessionKey: "my-app:wallet-session",
});

await walletCore.discoverWallets();
const wallets = walletCore.getAvailableWallets();
await walletCore.connect({ walletId: wallets[0].id });
```

## Adapter Usage

```js
import { ethers } from "./app/ethers.js";
import { createBrowserProvider } from "./wallet-core/adapters/ethers.js";
import { switchOrAddEthereumChain } from "./wallet-core/adapters/chain.js";

const eip1193Provider = walletCore.getEip1193Provider();
const ethersProvider = createBrowserProvider(eip1193Provider, ethers);

await switchOrAddEthereumChain(eip1193Provider, {
  chainId: 1337,
  chainName: "Hardhat Local",
  rpcUrl: "http://127.0.0.1:8545",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
});
```

The app still decides when to call chain helpers. The helper only wraps the low-level
wallet RPC calls.

## Recommended Repo Shape

```text
liberdus-wallet-core/
  README.md
  src/
    index.js
    core/
      discovery.js
      session.js
    adapters/
      chain.js
      ethers.js
  docs/
    consuming.md
  tests/
```

The first extraction should keep plain ESM files. Avoid forcing npm-package runtime
consumption until both consuming apps agree on the final public surface.
