import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { createWalletCore } from "../index.js";

const ACCOUNT = "0x24f55B1e86D67ca62146618Ee486AA4DF611CDD4";
const NEXT_ACCOUNT = "0x88dA9a35eF21c6a3c742aC2b8F46B940d42A7B5C";
const WALLET_ICON = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>";

let originalWindow;

class MemoryStorage {
  #items = new Map();

  getItem(key) {
    return this.#items.has(key) ? this.#items.get(key) : null;
  }

  setItem(key, value) {
    this.#items.set(key, String(value));
  }

  removeItem(key) {
    this.#items.delete(key);
  }
}

class ThrowingStorage {
  getItem() {
    throw new Error("getItem blocked");
  }

  setItem() {
    throw new Error("setItem blocked");
  }

  removeItem() {
    throw new Error("removeItem blocked");
  }
}

function createMockProvider({
  account = ACCOUNT,
  chainId = "0x38",
  providerFlags = { isMetaMask: true },
  revokePermissions = () => null,
} = {}) {
  const listeners = new Map();
  const requests = [];
  const onCalls = [];
  const removeCalls = [];

  function getListeners(event) {
    if (!listeners.has(event)) {
      listeners.set(event, new Set());
    }
    return listeners.get(event);
  }

  return {
    ...providerFlags,
    requests,
    onCalls,
    removeCalls,
    async request(payload) {
      requests.push(payload);
      if (payload.method === "eth_requestAccounts") return account ? [account] : [];
      if (payload.method === "eth_accounts") return account ? [account] : [];
      if (payload.method === "eth_chainId") return chainId;
      if (payload.method === "wallet_revokePermissions") return revokePermissions();
      throw new Error(`Unsupported request: ${payload.method}`);
    },
    on(event, handler) {
      onCalls.push(event);
      getListeners(event).add(handler);
    },
    removeListener(event, handler) {
      removeCalls.push(event);
      getListeners(event).delete(handler);
    },
    emit(event, data) {
      for (const handler of getListeners(event)) {
        handler(data);
      }
    },
    listenerCount(event) {
      return getListeners(event).size;
    },
  };
}

function installMockWindow({ provider, storage = new MemoryStorage() }) {
  const listeners = new Map();
  globalThis.window = {
    ethereum: provider,
    localStorage: storage,
    setTimeout: globalThis.setTimeout,
    phantom: undefined,
    addEventListener(event, handler) {
      listeners.set(event, handler);
    },
    removeEventListener(event, handler) {
      if (listeners.get(event) === handler) {
        listeners.delete(event);
      }
    },
    dispatchEvent(event) {
      listeners.get(event.type)?.(event);
      return true;
    },
  };

  return storage;
}

function createWalletCoreWithSession(savedSession, provider) {
  const storage = installMockWindow({ provider });
  storage.setItem(
    "test:wallet-session",
    typeof savedSession === "string" ? savedSession : JSON.stringify(savedSession),
  );
  return {
    storage,
    walletCore: createWalletCore({
      discoveryWaitMs: 0,
      storage,
      walletSessionKey: "test:wallet-session",
    }),
  };
}

function announceWallet(walletId, name, provider, { rdns = `org.liberdus.${walletId}` } = {}) {
  window.dispatchEvent({
    type: "eip6963:announceProvider",
    detail: {
      info: { uuid: walletId, name, rdns },
      provider,
    },
  });
}

async function flushAsyncEvents() {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

beforeEach(() => {
  originalWindow = globalThis.window;
});

afterEach(() => {
  if (originalWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = originalWindow;
  }
});

test("discovers a legacy injected wallet", async () => {
  installMockWindow({ provider: createMockProvider() });
  const walletCore = createWalletCore({ discoveryWaitMs: 0 });

  const wallets = await walletCore.discoverWallets();

  assert.equal(wallets.length, 1);
  assert.equal(wallets[0].id, "legacy:default");
  assert.equal(wallets[0].info.name, "MetaMask");
});

test("discovers wallet icons from legacy provider metadata", async () => {
  installMockWindow({
    provider: createMockProvider({
      providerFlags: {
        isMetaMask: true,
        info: {
          name: "MetaMask",
          rdns: "io.metamask",
          icon: WALLET_ICON,
        },
      },
    }),
  });
  const walletCore = createWalletCore({ discoveryWaitMs: 0 });

  const wallets = await walletCore.discoverWallets();

  assert.equal(wallets.length, 1);
  assert.equal(wallets[0].info.icon, WALLET_ICON);
});

test("discovers EVM wallets exposed through browser namespaces", async () => {
  const metaMaskProvider = createMockProvider();
  const trustProvider = createMockProvider({ providerFlags: { isTrustWallet: true } });
  const genericProvider = createMockProvider({ providerFlags: {} });

  installMockWindow({ provider: { providers: [metaMaskProvider] } });
  window.trustwallet = { ethereum: trustProvider };
  window.frontierWallet = { provider: genericProvider };

  const walletCore = createWalletCore({ discoveryWaitMs: 0 });

  const wallets = await walletCore.discoverWallets();
  const walletNames = wallets.map((wallet) => wallet.info.name);

  assert.equal(wallets.length, 3);
  assert.deepEqual(walletNames, ["Trust Wallet", "Frontier Wallet", "MetaMask"]);
  assert.deepEqual(metaMaskProvider.requests, []);
  assert.deepEqual(trustProvider.requests.map((request) => request.method), ["eth_chainId"]);
  assert.deepEqual(genericProvider.requests.map((request) => request.method), ["eth_chainId"]);
});

test("filters non-EVM wallets exposed through browser namespaces", async () => {
  const trustProvider = createMockProvider({ providerFlags: { isTrustWallet: true } });
  const tonProvider = createMockProvider({ chainId: "ton-mainnet", providerFlags: {} });
  const bitcoinProvider = createMockProvider({ chainId: "btc-mainnet", providerFlags: {} });
  const tronProvider = createMockProvider({ chainId: "tron-mainnet", providerFlags: {} });
  const throwingProvider = {
    async request() {
      throw new Error("Not an EVM provider");
    },
  };

  installMockWindow({ provider: { providers: [trustProvider] } });
  window.trustwallet = { ethereum: trustProvider };
  window.trustWalletTon = { provider: tonProvider };
  window.bitcoin = { provider: bitcoinProvider };
  window.tronLink = { provider: tronProvider };
  window.tonWallet = { provider: throwingProvider };

  const walletCore = createWalletCore({ discoveryWaitMs: 0 });
  const wallets = await walletCore.discoverWallets();

  assert.deepEqual(wallets.map((wallet) => wallet.info.name), ["Trust Wallet"]);
});

test("discovers primary wallets when namespace chain probes hang", async () => {
  const metaMaskProvider = createMockProvider();
  const hangingProvider = {
    request() {
      return new Promise(() => {});
    },
  };

  installMockWindow({ provider: { providers: [metaMaskProvider] } });
  window.hangingWallet = { provider: hangingProvider };

  const walletCore = createWalletCore({ discoveryWaitMs: 0 });
  const wallets = await Promise.race([
    walletCore.discoverWallets(),
    new Promise((resolve) => setTimeout(() => resolve("timed out"), 1000)),
  ]);

  assert.notEqual(wallets, "timed out");
  assert.deepEqual(wallets.map((wallet) => wallet.info.name), ["MetaMask"]);
});

test("discovers EIP-6963 wallets without probing chain during discovery", async () => {
  installMockWindow({ provider: null });
  const provider = createMockProvider({ chainId: "not-a-hex-chain", providerFlags: {} });
  const walletCore = createWalletCore({ discoveryWaitMs: 0 });

  await walletCore.discoverWallets();
  announceWallet("eip-wallet", "EIP Wallet", provider);

  const wallets = await walletCore.discoverWallets();

  assert.equal(wallets.length, 1);
  assert.equal(wallets[0].id, "eip-wallet");
  assert.deepEqual(provider.requests, []);
});

test("subscribers receive initial legacy wallet discovery events", async () => {
  installMockWindow({ provider: createMockProvider() });
  const walletCore = createWalletCore({ discoveryWaitMs: 0 });
  const events = [];

  const unsubscribe = walletCore.subscribe((event, wallets) => {
    if (event === "providersChanged") {
      events.push(wallets.map((wallet) => wallet.info.name));
    }
  });
  await flushAsyncEvents();

  assert.deepEqual(events, [["MetaMask"]]);

  unsubscribe();
});

test("createWalletCore tolerates blocked localStorage getter", async () => {
  const provider = createMockProvider();
  const listeners = new Map();
  globalThis.window = {
    ethereum: provider,
    setTimeout: globalThis.setTimeout,
    phantom: undefined,
    get localStorage() {
      throw new Error("localStorage blocked");
    },
    addEventListener(event, handler) {
      listeners.set(event, handler);
    },
    removeEventListener(event, handler) {
      if (listeners.get(event) === handler) {
        listeners.delete(event);
      }
    },
    dispatchEvent(event) {
      listeners.get(event.type)?.(event);
      return true;
    },
  };

  const walletCore = createWalletCore({ discoveryWaitMs: 0 });
  const wallets = await walletCore.discoverWallets();

  assert.equal(wallets.length, 1);
  assert.equal(walletCore.hasWalletSession(), false);
});

test("connect stores account, chain, selected wallet, and session", async () => {
  const storage = installMockWindow({ provider: createMockProvider() });
  const walletCore = createWalletCore({
    discoveryWaitMs: 0,
    storage,
    walletSessionKey: "test:wallet-session",
  });

  await walletCore.connect({ walletId: "legacy:default" });

  const state = walletCore.getState();
  assert.equal(state.account, ACCOUNT.toLowerCase());
  assert.equal(state.chainId, 56);
  assert.equal(state.selectedWalletId, "legacy:default");
  assert.equal(state.selectedWalletName, "MetaMask");
  assert.equal(walletCore.hasWalletSession(), true);
  assert.equal(storage.getItem("test:wallet-session"), JSON.stringify({
    walletId: "legacy:default",
    rdns: "io.metamask",
  }));
});

test("sync restores an existing wallet session without prompting", async () => {
  const provider = createMockProvider();
  const storage = installMockWindow({ provider });
  storage.setItem("test:wallet-session", JSON.stringify({ walletId: "legacy:default" }));

  const walletCore = createWalletCore({
    discoveryWaitMs: 0,
    storage,
    walletSessionKey: "test:wallet-session",
  });

  await walletCore.sync();

  assert.equal(walletCore.getState().account, ACCOUNT.toLowerCase());
  assert.deepEqual(provider.requests.map((request) => request.method), [
    "eth_chainId",
    "eth_accounts",
  ]);
});

test("sync preserves undiscovered saved sessions without reading fallback accounts", async () => {
  const provider = createMockProvider();
  const storage = installMockWindow({ provider });
  storage.setItem("test:wallet-session", JSON.stringify({ walletId: "missing:wallet" }));

  const walletCore = createWalletCore({
    discoveryWaitMs: 0,
    storage,
    walletSessionKey: "test:wallet-session",
  });

  await walletCore.sync();

  const state = walletCore.getState();
  assert.equal(state.account, null);
  assert.equal(state.chainId, null);
  assert.equal(state.selectedWalletId, null);
  assert.equal(state.selectedWalletName, null);
  assert.equal(state.selectedWalletRdns, null);
  assert.equal(state.sessionWalletId, null);
  assert.equal(state.injectedProvider, null);
  assert.equal(state.providerSource, null);
  assert.equal(storage.getItem("test:wallet-session"), JSON.stringify({ walletId: "missing:wallet" }));
  assert.deepEqual(provider.requests, []);
});

test("late EIP-6963 announcement restores a saved wallet session", async () => {
  const { walletCore } = createWalletCoreWithSession({
    walletId: "late-wallet",
    rdns: "org.liberdus.late-wallet",
  }, null);
  const events = [];
  const unsubscribe = walletCore.subscribe((event, data) => {
    events.push({ event, data });
  });

  await walletCore.sync();
  announceWallet("late-wallet", "Late Wallet", createMockProvider({ providerFlags: {} }));
  await flushAsyncEvents();

  const state = walletCore.getState();
  assert.equal(state.account, ACCOUNT.toLowerCase());
  assert.equal(state.selectedWalletId, "late-wallet");
  assert.equal(state.selectedWalletName, "Late Wallet");
  assert.equal(events.filter(({ event }) => event === "connected").length, 1);

  unsubscribe();
});

test("sync restores a saved EIP-6963 wallet when uuid changes but rdns is stable", async () => {
  const { storage, walletCore } = createWalletCoreWithSession({
    walletId: "old-uuid",
    rdns: "io.metamask",
  }, null);

  await walletCore.sync();
  announceWallet("new-uuid", "MetaMask", createMockProvider({ providerFlags: {} }), { rdns: "io.metamask" });
  await flushAsyncEvents();

  const state = walletCore.getState();
  assert.equal(state.account, ACCOUNT.toLowerCase());
  assert.equal(state.selectedWalletId, "new-uuid");
  assert.equal(storage.getItem("test:wallet-session"), JSON.stringify({
    walletId: "new-uuid",
    rdns: "io.metamask",
  }));
});

test("sync preserves saved session when rdns fallback is unauthorized", async () => {
  const unauthorizedProvider = createMockProvider({ account: null, providerFlags: {} });
  const savedSession = {
    walletId: "saved-uuid",
    rdns: "io.metamask",
  };
  const { storage, walletCore } = createWalletCoreWithSession(savedSession, null);

  await walletCore.discoverWallets();
  announceWallet("other-uuid", "MetaMask", unauthorizedProvider, { rdns: "io.metamask" });
  await walletCore.sync();

  assert.equal(walletCore.getState().account, null);
  assert.equal(storage.getItem("test:wallet-session"), JSON.stringify(savedSession));
  assert.deepEqual(unauthorizedProvider.requests.map((request) => request.method), [
    "eth_chainId",
    "eth_accounts",
  ]);

  announceWallet("saved-uuid", "MetaMask", createMockProvider({ providerFlags: {} }), { rdns: "io.metamask" });
  await flushAsyncEvents();

  const state = walletCore.getState();
  assert.equal(state.account, ACCOUNT.toLowerCase());
  assert.equal(state.selectedWalletId, "saved-uuid");
  assert.equal(storage.getItem("test:wallet-session"), JSON.stringify(savedSession));
});

test("sync does not restore an ambiguous saved wallet rdns", async () => {
  const firstProvider = createMockProvider({ providerFlags: {} });
  const secondProvider = createMockProvider({ providerFlags: {} });
  const { storage, walletCore } = createWalletCoreWithSession({
    walletId: "old-uuid",
    rdns: "io.metamask",
  }, null);

  await walletCore.discoverWallets();
  announceWallet("first-uuid", "MetaMask", firstProvider, { rdns: "io.metamask" });
  announceWallet("second-uuid", "MetaMask", secondProvider, { rdns: "io.metamask" });
  await walletCore.sync();

  assert.equal(walletCore.getState().account, null);
  assert.equal(storage.getItem("test:wallet-session"), JSON.stringify({
    walletId: "old-uuid",
    rdns: "io.metamask",
  }));
  assert.deepEqual(firstProvider.requests, []);
  assert.deepEqual(secondProvider.requests, []);
});

test("sync clears a discovered saved session when the wallet is unauthorized", async () => {
  const provider = createMockProvider({ account: null });
  const { storage, walletCore } = createWalletCoreWithSession({
    walletId: "legacy:default",
    rdns: "io.metamask",
  }, provider);

  await walletCore.sync();

  assert.equal(walletCore.getState().account, null);
  assert.equal(storage.getItem("test:wallet-session"), null);
  assert.deepEqual(provider.requests.map((request) => request.method), [
    "eth_chainId",
    "eth_accounts",
  ]);

  provider.emit("accountsChanged", [ACCOUNT]);
  assert.equal(walletCore.getState().account, null);
});

test("disconnect clears an undiscovered saved wallet session", async () => {
  const { storage, walletCore } = createWalletCoreWithSession({ walletId: "late-wallet" }, null);

  await walletCore.sync();
  await walletCore.disconnect({ revokePermissions: false });

  assert.equal(storage.getItem("test:wallet-session"), null);
  assert.equal(walletCore.hasWalletSession(), false);
});

test("sync restores old saved wallet session formats", async () => {
  for (const savedSession of ["legacy:default", "injected"]) {
    const provider = createMockProvider();
    const { storage, walletCore } = createWalletCoreWithSession(savedSession, provider);

    await walletCore.sync();

    assert.equal(walletCore.getState().account, ACCOUNT.toLowerCase());
    assert.equal(storage.getItem("test:wallet-session"), JSON.stringify({
      walletId: "legacy:default",
      rdns: "io.metamask",
    }));
  }
});

test("connect succeeds when session storage throws", async () => {
  installMockWindow({
    provider: createMockProvider(),
    storage: new ThrowingStorage(),
  });
  const walletCore = createWalletCore({
    discoveryWaitMs: 0,
    storage: globalThis.window.localStorage,
    walletSessionKey: "test:wallet-session",
  });

  await walletCore.connect({ walletId: "legacy:default" });

  const state = walletCore.getState();
  assert.equal(state.account, ACCOUNT.toLowerCase());
  assert.equal(state.chainId, 56);
  assert.equal(state.selectedWalletId, "legacy:default");
  assert.equal(walletCore.hasWalletSession(), false);
});

test("accountsChanged empty fully clears connected state", async () => {
  const provider = createMockProvider();
  const storage = installMockWindow({ provider });
  const walletCore = createWalletCore({
    discoveryWaitMs: 0,
    storage,
    walletSessionKey: "test:wallet-session",
  });

  await walletCore.connect({ walletId: "legacy:default" });
  provider.emit("accountsChanged", []);

  const state = walletCore.getState();
  assert.equal(state.account, null);
  assert.equal(state.chainId, null);
  assert.equal(state.chainName, null);
  assert.equal(state.selectedWalletId, null);
  assert.equal(state.selectedWalletName, null);
  assert.equal(state.selectedWalletRdns, null);
  assert.equal(state.sessionWalletId, null);
  assert.equal(state.injectedProvider, null);
  assert.equal(state.providerSource, null);
  assert.equal(storage.getItem("test:wallet-session"), null);
});

test("unsubscribing the last subscriber removes provider listeners", async () => {
  const provider = createMockProvider();
  installMockWindow({ provider });
  const walletCore = createWalletCore({ discoveryWaitMs: 0 });

  const unsubscribe = walletCore.subscribe(() => {});

  assert.equal(provider.listenerCount("accountsChanged"), 1);
  assert.equal(provider.listenerCount("chainChanged"), 1);
  assert.equal(provider.listenerCount("disconnect"), 1);

  unsubscribe();

  assert.equal(provider.listenerCount("accountsChanged"), 0);
  assert.equal(provider.listenerCount("chainChanged"), 0);
  assert.equal(provider.listenerCount("disconnect"), 0);
  assert.deepEqual(provider.removeCalls, ["accountsChanged", "chainChanged", "disconnect"]);
});

test("provider disconnect clears connected state and emits disconnected", async () => {
  const provider = createMockProvider();
  const storage = installMockWindow({ provider });
  const walletCore = createWalletCore({
    discoveryWaitMs: 0,
    storage,
    walletSessionKey: "test:wallet-session",
  });
  const events = [];
  const unsubscribe = walletCore.subscribe((event) => {
    events.push(event);
  });

  await walletCore.connect({ walletId: "legacy:default" });
  provider.emit("disconnect", { code: 4900, message: "Disconnected" });

  const state = walletCore.getState();
  assert.equal(state.account, null);
  assert.equal(state.selectedWalletId, null);
  assert.equal(storage.getItem("test:wallet-session"), null);
  assert.equal(provider.listenerCount("disconnect"), 0);
  assert.equal(events.filter((event) => event === "disconnected").length, 1);

  unsubscribe();
});

test("fallback provider disconnect before sync preserves saved session", async () => {
  const provider = createMockProvider();
  const storage = installMockWindow({ provider });
  storage.setItem("test:wallet-session", JSON.stringify({ walletId: "legacy:default" }));
  const walletCore = createWalletCore({
    discoveryWaitMs: 0,
    storage,
    walletSessionKey: "test:wallet-session",
  });
  const unsubscribe = walletCore.subscribe(() => {});

  provider.emit("disconnect", { code: 4900, message: "Disconnected" });

  assert.equal(storage.getItem("test:wallet-session"), JSON.stringify({ walletId: "legacy:default" }));

  await walletCore.sync();

  assert.equal(walletCore.getState().account, ACCOUNT.toLowerCase());
  assert.equal(walletCore.hasWalletSession(), true);

  unsubscribe();
});

test("fallback provider disconnect after sync without a session does not emit disconnected", async () => {
  const provider = createMockProvider();
  installMockWindow({ provider });
  const walletCore = createWalletCore({ discoveryWaitMs: 0 });
  const events = [];
  const unsubscribe = walletCore.subscribe((event) => {
    events.push(event);
  });

  await walletCore.sync();
  provider.emit("disconnect", { code: 4900, message: "Disconnected" });

  assert.equal(walletCore.getState().account, null);
  assert.equal(events.includes("disconnected"), false);

  unsubscribe();
});

test("fallback accountsChanged without a session does not restore account", async () => {
  const provider = createMockProvider();
  installMockWindow({ provider });
  const walletCore = createWalletCore({ discoveryWaitMs: 0 });

  await walletCore.sync();
  provider.emit("accountsChanged", [NEXT_ACCOUNT]);

  assert.equal(walletCore.getState().account, null);
});

test("provider disconnect listener moves when active wallet changes", async () => {
  const metaMaskProvider = createMockProvider();
  const rabbyProvider = createMockProvider({ providerFlags: { isRabby: true } });
  installMockWindow({ provider: { providers: [metaMaskProvider, rabbyProvider] } });
  const walletCore = createWalletCore({ discoveryWaitMs: 0 });
  const unsubscribe = walletCore.subscribe(() => {});

  await walletCore.connect({ walletId: "legacy:default" });
  assert.equal(metaMaskProvider.listenerCount("disconnect"), 1);
  assert.equal(rabbyProvider.listenerCount("disconnect"), 0);

  await walletCore.connect({ walletId: "legacy:rabby-2" });
  assert.equal(metaMaskProvider.listenerCount("disconnect"), 0);
  assert.equal(rabbyProvider.listenerCount("disconnect"), 1);
  assert.deepEqual(metaMaskProvider.removeCalls, ["accountsChanged", "chainChanged", "disconnect"]);

  unsubscribe();
});

test("disconnect clears wallet session state", async () => {
  const provider = createMockProvider();
  const storage = installMockWindow({ provider });
  const walletCore = createWalletCore({
    discoveryWaitMs: 0,
    storage,
    walletSessionKey: "test:wallet-session",
  });

  await walletCore.connect({ walletId: "legacy:default" });
  await walletCore.disconnect();

  const state = walletCore.getState();
  assert.equal(state.account, null);
  assert.equal(state.selectedWalletId, null);
  assert.equal(walletCore.hasWalletSession(), false);
  assert.equal(storage.getItem("test:wallet-session"), null);
  assert.equal(provider.listenerCount("disconnect"), 0);
  assert.deepEqual(
    provider.requests.find((request) => request.method === "wallet_revokePermissions"),
    {
      method: "wallet_revokePermissions",
      params: [{ eth_accounts: {} }],
    },
  );
});

test("disconnect can skip wallet permission revocation", async () => {
  const provider = createMockProvider();
  installMockWindow({ provider });
  const walletCore = createWalletCore({ discoveryWaitMs: 0 });

  await walletCore.connect({ walletId: "legacy:default" });
  await walletCore.disconnect({ revokePermissions: false });

  assert.equal(provider.requests.some((request) => request.method === "wallet_revokePermissions"), false);
});

test("disconnect can disable wallet permission revocation by default", async () => {
  const provider = createMockProvider();
  installMockWindow({ provider });
  const walletCore = createWalletCore({
    discoveryWaitMs: 0,
    revokePermissionsOnDisconnect: false,
  });

  await walletCore.connect({ walletId: "legacy:default" });
  await walletCore.disconnect();

  assert.equal(provider.requests.some((request) => request.method === "wallet_revokePermissions"), false);
});

test("disconnect clears local state when permission revocation fails", async () => {
  const provider = createMockProvider({
    revokePermissions: () => {
      throw new Error("wallet_revokePermissions unsupported");
    },
  });
  const storage = installMockWindow({ provider });
  const walletCore = createWalletCore({
    discoveryWaitMs: 0,
    storage,
    walletSessionKey: "test:wallet-session",
  });

  await walletCore.connect({ walletId: "legacy:default" });
  await walletCore.disconnect();

  assert.equal(walletCore.getState().account, null);
  assert.equal(walletCore.hasWalletSession(), false);
  assert.equal(storage.getItem("test:wallet-session"), null);
});

test("disconnect emits one disconnected event when revocation clears accounts first", async () => {
  let provider;
  provider = createMockProvider({
    revokePermissions: async () => {
      provider.emit("accountsChanged", []);
    },
  });
  installMockWindow({ provider });
  const walletCore = createWalletCore({ discoveryWaitMs: 0 });
  const events = [];
  const unsubscribe = walletCore.subscribe((event) => {
    events.push(event);
  });

  await walletCore.connect({ walletId: "legacy:default" });
  await walletCore.disconnect();

  assert.equal(events.filter((event) => event === "disconnected").length, 1);
  assert.equal(walletCore.getState().account, null);

  unsubscribe();
});
