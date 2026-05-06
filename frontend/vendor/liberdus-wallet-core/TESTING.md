# Testing Vendored Wallet Core

This folder is the Phase 8.5 served-file copy of `frontend/js/lib/wallet-core/`.

## Purpose

The claim/admin app should consume wallet core from this served vendor path:

```text
frontend/vendor/liberdus-wallet-core/
```

The internal source folder remains in:

```text
frontend/js/lib/wallet-core/
```

Use `npm run wallet-core:vendor` to refresh this vendored copy after wallet-core
source changes.

## Validation

```bash
node --check frontend/vendor/liberdus-wallet-core/index.js
node --check frontend/vendor/liberdus-wallet-core/adapters/chain.js
node --check frontend/vendor/liberdus-wallet-core/adapters/ethers.js
node --check frontend/js/shared/wallet-adapter.js
node --check frontend/js/shared/constants.js
node --check frontend/js/pages/claim.js
node --check frontend/js/pages/admin.js
```

```bash
node --input-type=module -e "await import('./frontend/vendor/liberdus-wallet-core/index.js'); await import('./frontend/vendor/liberdus-wallet-core/adapters/chain.js'); await import('./frontend/vendor/liberdus-wallet-core/adapters/ethers.js'); console.log('vendor-import-ok')"
```

```bash
rg '../lib/wallet-core|js/lib/wallet-core' frontend/js/shared frontend/js/pages
```

The final search should return no runtime imports from claim/admin shared code back to
the old internal wallet-core path.

The same runtime import and vendor dependency checks are available as one command:

```bash
npm run wallet-core:audit-consumer
```

For a browser smoke test:

```bash
npm run serve
```

Open `http://127.0.0.1:4173/`, connect a wallet, and verify the wallet picker,
disconnect menu, and local claim flow still work.
