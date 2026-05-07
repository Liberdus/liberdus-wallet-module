import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { createWalletCore } from "../index.js";

const ACCOUNT = "0x24f55B1e86D67ca62146618Ee486AA4DF611CDD4";

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

function createMockProvider({ account = ACCOUNT, chainId = "0x38" } = {}) {
  const listeners = new Map();
  const requests = [];

  return {
    isMetaMask: true,
    requests,
    async request(payload) {
      requests.push(payload);
      if (payload.method === "eth_requestAccounts") return [account];
      if (payload.method === "eth_accounts") return [account];
      if (payload.method === "eth_chainId") return chainId;
      throw new Error(`Unsupported request: ${payload.method}`);
    },
    on(event, handler) {
      listeners.set(event, handler);
    },
    removeListener(event, handler) {
      if (listeners.get(event) === handler) {
        listeners.delete(event);
      }
    },
    emit(event, data) {
      listeners.get(event)?.(data);
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
  assert.equal(storage.getItem("test:wallet-session"), JSON.stringify({ walletId: "legacy:default" }));
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

test("disconnect clears wallet session state", async () => {
  const storage = installMockWindow({ provider: createMockProvider() });
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
});
