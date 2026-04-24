# liberdus-wallet-module

Frontend-only wallet module base and Hardhat test harness for Liberdus dapps.

This repo keeps the Solidity contracts, static claimant/admin UIs, local Hardhat deployment scripts, and Playwright coverage. It no longer requires a backend server or database. Admin-created rounds, claim proofs, account rows, and recovery-import test data are stored in the local browser for the active `deploymentKey`.

## Local Usage

```bash
npm install
npm run compile
npm test
```

Run the full local dapp:

```bash
npm run node
npm run deploy:local
npm run fund:owner:local
npm run serve
```

Then open:

- `http://127.0.0.1:4173/frontend/index.html` for the claimant page
- `http://127.0.0.1:4173/frontend/admin.html` for the owner-only admin page

`npm run deploy:local` writes `frontend/config.local.json` with local Hardhat addresses and a fresh `deploymentKey`. That key scopes browser-local airdrop data so a Hardhat reset does not reuse old local rounds.

## Frontend Storage

The frontend lives in `frontend/` and is served without a framework or build step.

The admin page can:

- build or upload claims JSON
- save draft rounds in browser storage
- fund the airdrop contract
- deploy saved rounds on chain
- inspect saved round claims
- import/manage account rows and recovery submissions locally

The claimant page reads wallet-specific proofs from the same browser storage. Persistence is intentionally lightweight and local to the browser; clearing site data removes saved rounds and admin data.

## Useful Scripts

```bash
npm run node
npm run deploy:local
npm run fund:owner:local
npm run serve
npm run test:e2e
npm run merkle -- .\path\to\my-round.claims.json
```

## BSC Deployment

Create a `.env` file from `.env.example` and fill in:

```dotenv
DEPLOYER_PRIVATE_KEY=
BSC_TESTNET_RPC_URL=
BSC_MAINNET_RPC_URL=
BSC_TESTNET_TOKEN_ADDRESS=
BSC_MAINNET_TOKEN_ADDRESS=
BSCSCAN_API_KEY=
DEPLOY_CONFIRMATIONS=5
```

Then deploy:

```bash
npm run deploy:airdrop:bsc:testnet
```

or for mainnet:

```bash
npm run deploy:airdrop:bsc:mainnet
```

Each deployment writes a reusable record to `deployments/<network>/EpochMerkleAirdrop.json`. If `BSCSCAN_API_KEY` is set, the deploy script also verifies automatically on BscScan.

## Contract Behavior

`EpochMerkleAirdrop` is designed around discrete airdrop epochs:

- each new epoch stores one Merkle root and one claim deadline
- multiple epochs may overlap and remain claimable at the same time
- claims are tracked independently per epoch with a bitmap
- claims are allowed only before the epoch deadline
- the owner can update a deadline or set it to `0` to disable an epoch
- the contract is funded by transferring the ERC20 token into it directly
- withdrawals are owner-controlled
- ownership transfers use OpenZeppelin `Ownable2Step`
- non-airdrop ERC20 tokens can be recovered by the owner

## Merkle Tree Format

The contract uses the OpenZeppelin standard Merkle tree leaf format:

```solidity
keccak256(bytes.concat(keccak256(abi.encode(index, account, amount))))
```

The frontend, tests, and CLI use that same leaf shape:

```text
[index, account, amount]
```

with types:

```text
["uint256", "address", "uint256"]
```
