import {
  APP_STORAGE_KEYS,
  APP_STORAGE_PREFIX,
  LEGACY_APP_STORAGE_KEYS,
} from "./constants.js";

export function getAppLocalStorageKeys(storage = window.localStorage) {
  const keys = new Set([...APP_STORAGE_KEYS, ...LEGACY_APP_STORAGE_KEYS]);

  if (storage) {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(APP_STORAGE_PREFIX)) {
        keys.add(key);
      }
    }
  }

  return [...keys].sort();
}

export function clearAppLocalStorage(storage = window.localStorage) {
  if (!storage) return 0;

  let removedCount = 0;
  for (const key of getAppLocalStorageKeys(storage)) {
    if (storage.getItem(key) == null) continue;
    storage.removeItem(key);
    removedCount += 1;
  }

  return removedCount;
}
