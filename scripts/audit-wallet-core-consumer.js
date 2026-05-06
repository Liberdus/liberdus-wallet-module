const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const VENDOR_DIR = path.join(REPO_ROOT, "frontend", "vendor", "liberdus-wallet-core");

function readText(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function listFiles(directory, predicate = () => true) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(fullPath, predicate));
      continue;
    }

    if (predicate(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertFile(relativePath) {
  assert(fs.existsSync(path.join(REPO_ROOT, relativePath)), `Missing required file: ${relativePath}`);
}

function auditRuntimeImports() {
  const walletAdapter = readText("frontend/js/shared/wallet-adapter.js");
  const constants = readText("frontend/js/shared/constants.js");
  const sharedAndPageFiles = listFiles(path.join(REPO_ROOT, "frontend", "js"), (filePath) => (
    filePath.endsWith(".js")
  ));

  assert(
    walletAdapter.includes("../../vendor/liberdus-wallet-core/index.js"),
    "wallet-adapter.js must consume createWalletCore from the served vendor path.",
  );
  assert(
    walletAdapter.includes("../../vendor/liberdus-wallet-core/adapters/chain.js"),
    "wallet-adapter.js must consume chain helpers from the served vendor path.",
  );
  assert(
    walletAdapter.includes("../../vendor/liberdus-wallet-core/adapters/ethers.js"),
    "wallet-adapter.js must consume ethers adapter from the served vendor path.",
  );
  assert(
    constants.includes("../../vendor/liberdus-wallet-core/adapters/chain.js"),
    "constants.js must re-export toChainIdHex from the served vendor path.",
  );

  for (const filePath of sharedAndPageFiles) {
    const relativePath = path.relative(REPO_ROOT, filePath);
    const contents = fs.readFileSync(filePath, "utf8");
    assert(
      !contents.includes("../lib/wallet-core") && !contents.includes("js/lib/wallet-core"),
      `${relativePath} imports the internal wallet-core path instead of the vendor path.`,
    );
  }
}

function auditVendorFiles() {
  const manifestPath = path.join(VENDOR_DIR, "EXPORT_MANIFEST.json");
  assert(fs.existsSync(manifestPath), "Vendor wallet core is missing EXPORT_MANIFEST.json.");

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const expectedFiles = [
    ...(manifest.entrypoints || []),
    ...(manifest.coreFiles || []),
    ...(manifest.compatibilityFiles || []),
    ...(manifest.docs || []),
    "TESTING.md",
    "package.json",
  ];

  for (const relativePath of expectedFiles) {
    assertFile(path.join("frontend", "vendor", "liberdus-wallet-core", relativePath));
  }

  const vendorJsFiles = listFiles(VENDOR_DIR, (filePath) => filePath.endsWith(".js"));
  for (const filePath of vendorJsFiles) {
    const relativePath = path.relative(REPO_ROOT, filePath);
    const contents = fs.readFileSync(filePath, "utf8");
    assert(
      !contents.includes("../../../shared") && !contents.includes("frontend/js/shared") && !contents.includes("shared/ethers"),
      `${relativePath} contains an app-local shared import.`,
    );
  }
}

function auditLegacyCompatibilityRemoved() {
  const removedFiles = [
    "frontend/js/shared/wallet.js",
    "frontend/js/lib/wallet-core/discovery.js",
    "frontend/js/lib/wallet-core/session.js",
    "frontend/vendor/liberdus-wallet-core/discovery.js",
    "frontend/vendor/liberdus-wallet-core/session.js",
  ];

  for (const relativePath of removedFiles) {
    assert(!fs.existsSync(path.join(REPO_ROOT, relativePath)), `Legacy compatibility file still exists: ${relativePath}`);
  }
}

function main() {
  auditVendorFiles();
  auditRuntimeImports();
  auditLegacyCompatibilityRemoved();
  console.log("wallet-core-consumer-audit-ok");
}

try {
  main();
} catch (error) {
  console.error(error.message || String(error));
  process.exitCode = 1;
}
