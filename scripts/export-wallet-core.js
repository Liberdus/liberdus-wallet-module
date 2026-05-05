const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const SOURCE_DIR = path.join(REPO_ROOT, "frontend", "js", "lib", "wallet-core");
const DEFAULT_OUTPUT_DIR = path.join(REPO_ROOT, "dist", "wallet-core");

function parseArgs(argv) {
  const options = {
    outputDir: DEFAULT_OUTPUT_DIR,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") {
      index += 1;
      options.outputDir = path.resolve(argv[index] || "");
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function readManifest() {
  const manifestPath = path.join(SOURCE_DIR, "EXPORT_MANIFEST.json");
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function copyFile(relativePath, outputDir) {
  const sourcePath = path.join(SOURCE_DIR, relativePath);
  const targetPath = path.join(outputDir, relativePath);

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Wallet core export source file is missing: ${relativePath}`);
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function copyManifestFiles(manifest, outputDir) {
  const files = [
    ...manifest.entrypoints,
    ...manifest.coreFiles,
    ...manifest.compatibilityFiles,
    ...manifest.docs,
    "EXPORT_MANIFEST.json",
  ];

  for (const relativePath of files) {
    copyFile(relativePath, outputDir);
  }
}

function writePackageMetadata(manifest, outputDir) {
  const packageMetadata = {
    name: manifest.name,
    private: true,
    type: "module",
    description: manifest.description,
    exports: {
      ".": "./index.js",
      "./adapters/chain": "./adapters/chain.js",
      "./adapters/ethers": "./adapters/ethers.js",
    },
  };

  fs.writeFileSync(
    path.join(outputDir, "package.json"),
    `${JSON.stringify(packageMetadata, null, 2)}\n`,
  );
}

function writeStandaloneReadme(outputDir) {
  fs.copyFileSync(
    path.join(SOURCE_DIR, "SHARED_REPO_README.md"),
    path.join(outputDir, "README.md"),
  );
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifest = readManifest();

  fs.mkdirSync(options.outputDir, { recursive: true });
  copyManifestFiles(manifest, options.outputDir);
  writeStandaloneReadme(options.outputDir);
  writePackageMetadata(manifest, options.outputDir);

  console.log(`Exported wallet core to ${options.outputDir}`);
}

try {
  main();
} catch (error) {
  console.error(error.message || String(error));
  process.exitCode = 1;
}
