export { toChainIdHex } from "../../vendor/liberdus-wallet-core/adapters/chain.js";

export const APP_STORAGE_NAMESPACE = "liberdus-wallet-module";
export const APP_STORAGE_PREFIX = `${APP_STORAGE_NAMESPACE}:`;
export const STORAGE_KEY = `${APP_STORAGE_PREFIX}ui-config`;
export const WALLET_SESSION_KEY = `${APP_STORAGE_PREFIX}wallet-session`;
export const CLAIMS_STORAGE_KEY = `${APP_STORAGE_PREFIX}claims:v1`;
export const ADMIN_STORAGE_KEY = `${APP_STORAGE_PREFIX}admin:v1`;
export const APP_STORAGE_KEYS = Object.freeze([
  STORAGE_KEY,
  WALLET_SESSION_KEY,
  CLAIMS_STORAGE_KEY,
  ADMIN_STORAGE_KEY,
]);
export const LEGACY_APP_STORAGE_KEYS = Object.freeze([
  "liberdus-airdrop-ui-config",
  "liberdus-airdrop-wallet-session",
  "liberdus-airdrop-local-claims-v1",
  "liberdus-airdrop-local-admin-v1",
]);
export const UI_ROOT = new URL("../../", import.meta.url);
export const CHAIN_NAME_BY_ID = {
  1: "Ethereum",
  10: "OP Mainnet",
  56: "BNB Smart Chain",
  97: "BNB Smart Chain Testnet",
  137: "Polygon",
  42161: "Arbitrum One",
  43114: "Avalanche C-Chain",
  8453: "Base",
  11155111: "Sepolia",
  1337: "Localhost 8545",
  31337: "Hardhat Local",
};

export const AIRDROP_ABI = [
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function currentEpoch() view returns (uint256)",
  "function merkleRoots(uint256) view returns (bytes32)",
  "function deadlines(uint256) view returns (uint256)",
  "function epochClaimedAmounts(uint256) view returns (uint256)",
  "function epochInfo(uint256) view returns (bytes32,uint256,uint256)",
  "function isClaimed(uint256,uint256) view returns (bool)",
  "function startNewAirdrop(bytes32,uint256)",
  "function setEpochDeadline(uint256,uint256)",
  "function transferOwnership(address)",
  "function acceptOwnership()",
  "function claim(uint256,uint256,address,uint256,bytes32[])",
  "function withdraw(address,uint256)",
  "function recoverERC20(address,address,uint256)",
];

export const AIRDROP_ERROR_ABI = [
  "error ZeroAddress()",
  "error InvalidMerkleRoot()",
  "error InvalidDeadline()",
  "error EpochNotStarted(uint256 epoch)",
  "error AlreadyClaimed(uint256 epoch, uint256 index)",
  "error InvalidProof()",
  "error ClaimWindowClosed(uint256 epoch, uint256 deadline)",
  "error InvalidRecoverToken()",
];

export const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "function mint(address,uint256)",
];

export const ACCESS_CONTROL_ERROR_ABI = [
  "error OwnableUnauthorizedAccount(address account)",
  "error OwnableInvalidOwner(address owner)",
];

export const ERC20_ERROR_ABI = [
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InvalidSender(address sender)",
  "error ERC20InvalidReceiver(address receiver)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
  "error ERC20InvalidApprover(address approver)",
  "error ERC20InvalidSpender(address spender)",
  "error SafeERC20FailedOperation(address token)",
];
