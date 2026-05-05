import { createWalletCore } from "../lib/wallet-core/index.js";
import { addEthereumChain, switchOrAddEthereumChain } from "../lib/wallet-core/adapters/chain.js";
import { createBrowserProvider } from "../lib/wallet-core/adapters/ethers.js";
import { CHAIN_NAME_BY_ID, WALLET_SESSION_KEY } from "./constants.js";
import { ethers } from "./ethers.js";

const walletCore = createWalletCore({
  storage: typeof window !== "undefined" ? window.localStorage : null,
  walletSessionKey: WALLET_SESSION_KEY,
});

function normalizeWalletIdentityValue(value) {
  return String(value || "").trim().toLowerCase();
}

function isBnbChainConfig(config) {
  const chainId = Number(config?.chainId);
  return chainId === 56 || chainId === 97;
}

function getConfiguredNetworkLabel(config) {
  return String(config?.networkName || "").trim() || "the configured network";
}

function isPhantomWallet(wallet) {
  if (!wallet) return false;

  const name = normalizeWalletIdentityValue(wallet.info?.name);
  const rdns = normalizeWalletIdentityValue(wallet.info?.rdns);
  return name.includes("phantom")
    || rdns.includes("phantom")
    || Boolean(wallet.provider?.isPhantom);
}

function getWalletCompatibility(config, wallet) {
  if (!wallet) {
    return {
      isSupported: true,
      isDisabled: false,
      disabledReason: "",
      errorMessage: "",
    };
  }

  if (isBnbChainConfig(config) && isPhantomWallet(wallet)) {
    const networkLabel = getConfiguredNetworkLabel(config);
    const walletName = wallet.info?.name || "This wallet";
    return {
      isSupported: false,
      isDisabled: true,
      disabledReason: `Doesn't support ${networkLabel}.`,
      errorMessage: `${walletName} does not support ${networkLabel}.`,
    };
  }

  return {
    isSupported: true,
    isDisabled: false,
    disabledReason: "",
    errorMessage: "",
  };
}

function assertWalletSupported(config, wallet) {
  const compatibility = getWalletCompatibility(config, wallet);
  if (!compatibility.isSupported) {
    throw new Error(compatibility.errorMessage);
  }

  return compatibility;
}

async function enforceSelectedWalletPolicy(runtime) {
  const state = walletCore.getState();
  if (!state.selectedWalletId) return true;

  const selectedWallet = await walletCore.resolveWalletById(state.selectedWalletId);
  const compatibility = getWalletCompatibility(runtime.config, selectedWallet);
  if (compatibility.isSupported) return true;

  await walletCore.disconnect();
  syncRuntimeWithCore(runtime);
  return false;
}

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
    runtime.provider = createBrowserProvider(injected, ethers);
    runtime.providerSource = injected;
  }

  return runtime.provider;
}

export async function connectWallet(runtime, walletId) {
  const wallet = await walletCore.resolveWalletById(walletId);
  if (!wallet) {
    throw new Error("The selected wallet is no longer available. Refresh the page and try again.");
  }

  assertWalletSupported(runtime.config, wallet);

  const account = await walletCore.connect({ walletId });
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
  await walletCore.sync();
  syncRuntimeWithCore(runtime);

  if (!await enforceSelectedWalletPolicy(runtime)) {
    return;
  }

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

  await addEthereumChain(injected, {
    chainId: config.chainId,
    chainName: config.networkName,
    rpcUrl: config.rpcUrl,
    nativeCurrency: config.nativeCurrency,
  });
}

export async function switchConfiguredNetwork(config) {
  const injected = walletCore.getEip1193Provider();
  if (!injected) throw new Error("No compatible wallet was detected.");
  if (!Number.isInteger(Number(config.chainId))) throw new Error("Configured chainId is required.");

  await switchOrAddEthereumChain(injected, {
    chainId: config.chainId,
    chainName: config.networkName,
    rpcUrl: config.rpcUrl,
    nativeCurrency: config.nativeCurrency,
  });
}

export function hasWalletSession() {
  return walletCore.hasWalletSession();
}

export async function getAvailableWallets(config = null) {
  await walletCore.discoverWallets();
  return walletCore.getAvailableWallets().map((wallet) => {
    const compatibility = getWalletCompatibility(config, wallet);
    return {
      ...wallet,
      isDisabled: compatibility.isDisabled,
      disabledReason: compatibility.disabledReason,
    };
  });
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
