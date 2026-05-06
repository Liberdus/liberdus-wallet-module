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
    ...(manifest.entrypoints || []),
    ...(manifest.coreFiles || []),
    ...(manifest.compatibilityFiles || []),
  ];

  for (const relativePath of files) {
    copyFile(relativePath, outputDir);
  }
}

function cleanOutputDir(outputDir) {
  if (!fs.existsSync(outputDir)) return;

  const entries = fs.readdirSync(outputDir);
  const manifestPath = path.join(outputDir, "EXPORT_MANIFEST.json");
  const packagePath = path.join(outputDir, "package.json");

  if (entries.length > 0 && !fs.existsSync(manifestPath) && !fs.existsSync(packagePath)) {
    throw new Error(`Refusing to clean non-wallet-core output directory: ${outputDir}`);
  }

  for (const entry of entries) {
    fs.rmSync(path.join(outputDir, entry), { force: true, recursive: true });
  }
}

function writePackageMetadata(manifest, outputDir) {
  const packageMetadata = {
    name: manifest.name,
    type: "module",
    sideEffects: false,
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

function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifest = readManifest();

  cleanOutputDir(options.outputDir);
  fs.mkdirSync(options.outputDir, { recursive: true });
  copyManifestFiles(manifest, options.outputDir);
  writePackageMetadata(manifest, options.outputDir);

  console.log(`Exported wallet core to ${options.outputDir}`);
}

try {
  main();
} catch (error) {
  console.error(error.message || String(error));
  process.exitCode = 1;
}
