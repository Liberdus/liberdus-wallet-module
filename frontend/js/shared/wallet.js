import { createWalletCore } from "../lib/wallet-core/index.js";
import { createBrowserProvider } from "../lib/wallet-core/adapters/ethers.js";
import { CHAIN_NAME_BY_ID, WALLET_SESSION_KEY, toChainIdHex } from "./constants.js";

const walletCore = createWalletCore({
  storage: typeof window !== "undefined" ? window.localStorage : null,
  walletSessionKey: WALLET_SESSION_KEY,
});

function syncRuntimeWithCore(runtime) {
  const state = walletCore.getState();
  const injected = walletCore.getEip1193Provider();

  if (runtime.providerSource !== injected) {
    runtime.provider = null;
    runtime.providerSource = null;
    runtime.signer = null;
  }

  runtime.account = state.account;
  runtime.chainId = state.chainId;
  runtime.chainName = resolveChainName(state.chainId, state.chainName, runtime.config);
  runtime.injectedProvider = injected;
  runtime.selectedWalletId = state.selectedWalletId;
  runtime.selectedWalletName = state.selectedWalletName;
  runtime.selectedWalletRdns = state.selectedWalletRdns;
}

function resolveChainName(chainId, networkName, config) {
  const numericChainId = Number(chainId);
  if (!Number.isFinite(numericChainId)) return null;
  if (numericChainId === config?.chainId && config?.networkName) {
    return config.networkName;
  }
  if (typeof networkName === "string" && networkName && networkName !== "unknown") {
    return networkName;
  }
  return CHAIN_NAME_BY_ID[numericChainId] || null;
}

export async function ensureProvider(runtime) {
  const injected = walletCore.getEip1193Provider();
  if (!injected) throw new Error("No compatible wallet was detected in this browser.");

  if (!runtime.provider || runtime.providerSource !== injected) {
    runtime.provider = createBrowserProvider(injected);
    runtime.providerSource = injected;
  }

  return runtime.provider;
}

export async function connectWallet(runtime, walletId) {
  const account = await walletCore.connect({ walletId, config: runtime.config });
  syncRuntimeWithCore(runtime);
  runtime.provider = await ensureProvider(runtime);
  runtime.signer = await runtime.provider.getSigner();
  runtime.account = account;
  return runtime.account;
}

export async function disconnectWallet(runtime) {
  await walletCore.disconnect();
  syncRuntimeWithCore(runtime);
  runtime.signer = null;

  try {
    const provider = await ensureProvider(runtime);
    const network = await provider.getNetwork();
    runtime.chainId = Number(network.chainId);
    runtime.chainName = resolveChainName(runtime.chainId, network.name, runtime.config);
  } catch {
    runtime.chainId = null;
    runtime.chainName = null;
    runtime.provider = null;
    runtime.providerSource = null;
  }
}

export async function syncWalletState(runtime) {
  await walletCore.sync(runtime.config);
  syncRuntimeWithCore(runtime);

  if (!runtime.account) {
    runtime.signer = null;
    return;
  }

  runtime.provider = await ensureProvider(runtime);
  runtime.signer = await runtime.provider.getSigner();
}

export function resetProvider(runtime, nextChainId = null) {
  runtime.provider = null;
  runtime.providerSource = null;
  runtime.signer = null;
  if (nextChainId !== null && nextChainId !== undefined) {
    runtime.chainId = Number(nextChainId);
    runtime.chainName = resolveChainName(runtime.chainId, null, runtime.config);
    return;
  }
  runtime.chainName = null;
}

export async function addConfiguredNetwork(config) {
  const injected = walletCore.getEip1193Provider();
  if (!injected) throw new Error("No compatible wallet was detected.");
  if (!Number.isInteger(Number(config.chainId))) throw new Error("Configured chainId is required.");
  if (!config.networkName || !config.rpcUrl || !config.nativeCurrency) {
    throw new Error("Configured networkName, rpcUrl, and nativeCurrency are required.");
  }

  const chainIdHex = toChainIdHex(config.chainId);

  await injected.request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: chainIdHex,
        chainName: config.networkName,
        rpcUrls: [config.rpcUrl],
        nativeCurrency: config.nativeCurrency,
      },
    ],
  });
}

export async function switchConfiguredNetwork(config) {
  const injected = walletCore.getEip1193Provider();
  if (!injected) throw new Error("No compatible wallet was detected.");
  if (!Number.isInteger(Number(config.chainId))) throw new Error("Configured chainId is required.");

  const chainIdHex = toChainIdHex(config.chainId);

  try {
    await injected.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
  } catch (error) {
    if (error?.code === 4902) {
      await addConfiguredNetwork(config);
      await switchConfiguredNetwork(config);
      return;
    }

    throw error;
  }
}

export function hasWalletSession() {
  return walletCore.hasWalletSession();
}

export async function getAvailableWallets(config = null) {
  await walletCore.discoverWallets();
  return walletCore.getAvailableWallets(config);
}

export function bindWalletEvents({ onAccountsChanged, onChainChanged }) {
  return walletCore.subscribe((event, data) => {
    if (event === "accountChanged" && onAccountsChanged) {
      onAccountsChanged();
    }
    if (event === "chainChanged" && onChainChanged) {
      onChainChanged(data);
    }
  });
}
