# Adding A Local Airdrop Round

This repo is a frontend-only local test harness. It does not use a backend server or database.

The admin page stores round metadata and claim proofs in browser `localStorage` under the `liberdus-wallet-module:` namespace, scoped by the active `deploymentKey` from `frontend/config.local.json` or `frontend/config.json`. The claimant page reads deployed rounds from that same local browser storage and verifies the round against onchain epoch state before showing a claim.

Clearing site data removes saved rounds, account rows, and recovery-import test data. The admin page also has a `Clear Local Storage` action that removes app-owned local storage keys without changing onchain contract state.

## 1. Create Claims JSON

You can create claims JSON in either of these ways:

1. Use the admin page builder to enter wallet addresses and amounts, then download the generated JSON file.
2. Create a JSON file manually in any local folder with one entry per wallet.

Example:

```json
[
  {
    "index": 0,
    "account": "0x1111111111111111111111111111111111111111",
    "amount": "100"
  },
  {
    "index": 1,
    "account": "0x2222222222222222222222222222222222222222",
    "amount": "250.5"
  }
]
```

Rules:

- `index` must be unique per row.
- `index` should usually start at `0` and increase by `1`.
- `account` must be a valid EVM address.
- Each wallet should appear only once per round.
- Use `amount` for human token units like `"100"` or `"250.5"`.
- If you already have base units, use `amountRaw` instead of `amount`.

Example using `amountRaw`:

```json
[
  {
    "index": 0,
    "account": "0x1111111111111111111111111111111111111111",
    "amountRaw": "100000000000000000000"
  }
]
```

## 2. Calculate The Merkle Root

You can calculate the root in the admin UI or with the CLI.

CLI:

```bash
npm run merkle -- .\path\to\my-round.claims.json
```

That prints:

- the Merkle root
- claim count
- total rewards

For a JSON summary:

```bash
npm run merkle -- .\path\to\my-round.claims.json --stdout
```

## 3. Save The Round Locally

Open [frontend/admin.html](frontend/admin.html), connect the owner wallet, then use the `Prepare` tab.

1. Build claims in `Build Claims JSON` and click `Use Built Claims`, or upload an existing claims JSON file.
2. Verify the preview table, total rewards, and calculated root.
3. Enter the deadline.
4. Click `Save Round Locally`.

Saving locally stores the draft round plus rebuilt claim proofs in browser storage. Nothing is written to a backend or database.

## 4. Fund And Deploy The Saved Draft

Open the `Rounds` tab after saving the draft.

1. Click `Fund Total` if the airdrop contract needs more LIB.
2. Click `Deploy` on the saved draft row.
3. Confirm the wallet transaction.

Deployment calls `startNewAirdrop(root, deadline)` on the local or configured airdrop contract. After the transaction confirms, the admin page marks the saved browser-local round as deployed and links it to the onchain epoch.

The contract rejects:

- zero roots
- past deadlines

## 5. Verify On The Claimant Page

After deploying the saved round:

1. Open [frontend/index.html](frontend/index.html).
2. Connect a wallet that has an allocation.
3. Confirm the claim appears.
4. Confirm the displayed amount matches the claims JSON.
5. Test a claim.

The claimant page only shows rounds that are both present in browser-local storage and live on chain with a matching Merkle root and active deadline.

## Optional Deadline Updates

If you need to close or reschedule an epoch after launch:

1. Open the admin page.
2. Use `Contract` or `Epoch Management` controls.
3. Set a new future deadline, or disable the epoch by setting its deadline to `0`.

The claimant page treats a deadline of `0` as closed.

## Summary

The normal local workflow is:

1. Create claims JSON in the admin page builder or a local file.
2. Calculate the root in the admin page or with `npm run merkle`.
3. Save the round locally from the `Prepare` tab.
4. Fund the contract if needed.
5. Deploy the saved draft from the `Rounds` tab.
6. Verify the claimant page shows the deployed round.

## Frontend Config

Local development uses the ignored `frontend/config.local.json` when running on `localhost`. `npm run deploy:local` writes that file with local Hardhat addresses and a fresh `deploymentKey`.

Hosted deployments should serve one runtime config file as `frontend/config.json`. You can use `frontend/config.test.json` or `frontend/config.prod.json` as templates, then fill in the deployed contract addresses and `deploymentKey`.
