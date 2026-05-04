import { ethers } from "../../../shared/ethers.js";

export function createBrowserProvider(injectedProvider) {
  if (!injectedProvider) {
    throw new Error("No injected provider was available to create an ethers provider.");
  }

  return new ethers.BrowserProvider(injectedProvider);
}
