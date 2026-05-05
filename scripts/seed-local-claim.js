const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");

const LEAF_TYPES = ["uint256", "address", "uint256"];

function usage() {
  console.error([
    "Usage:",
    "  DEMO_CLAIM_ACCOUNT=<wallet> npm run demo:claim:local",
    "  DEMO_CLAIM_ACCOUNT=<wallet> DEMO_CLAIM_AMOUNT=25 npm run demo:claim:local",
    "",
    "Example:",
    "  npm run node",
    "  npm run deploy:local",
    "  DEMO_CLAIM_ACCOUNT=0xYourWalletAddress DEMO_CLAIM_AMOUNT=25 npm run demo:claim:local",
    "  npm run serve",
  ].join("\n"));
}

function parseArgs(argv) {
  const options = {
    account: process.env.DEMO_CLAIM_ACCOUNT || "",
    amount: process.env.DEMO_CLAIM_AMOUNT || "125",
    index: process.env.DEMO_CLAIM_INDEX || "0",
    deadlineMinutes: Number(process.env.DEMO_CLAIM_DEADLINE_MINUTES || 120),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--account") {
      index += 1;
      options.account = argv[index] || "";
      continue;
    }

    if (arg === "--amount") {
      index += 1;
      options.amount = argv[index] || "";
      continue;
    }

    if (arg === "--index") {
      index += 1;
      options.index = argv[index] || "";
      continue;
    }

    if (arg === "--deadline-minutes") {
      index += 1;
      options.deadlineMinutes = Number(argv[index]);
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function compareHex(left, right) {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);

  if (leftValue === rightValue) return 0;
  return leftValue < rightValue ? -1 : 1;
}

function hashLeaf(index, account, amountRaw) {
  const { ethers } = hre;
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(LEAF_TYPES, [index, account, amountRaw]);
  return ethers.keccak256(ethers.keccak256(encoded));
}

function hashPair(left, right) {
  const { ethers } = hre;
  const ordered = compareHex(left, right) <= 0 ? [left, right] : [right, left];
  return ethers.keccak256(ethers.concat(ordered));
}

function buildTree(claims) {
  const hashedValues = claims
    .map((claim, valueIndex) => ({
      claim,
      valueIndex,
      hash: hashLeaf(claim.index, claim.account, claim.amountRaw),
    }))
    .sort((left, right) => compareHex(left.hash, right.hash));

  const tree = new Array((2 * hashedValues.length) - 1);
  const claimTreeIndices = new Array(claims.length);

  for (const [leafIndex, item] of hashedValues.entries()) {
    const treeIndex = tree.length - 1 - leafIndex;
    tree[treeIndex] = item.hash;
    claimTreeIndices[item.valueIndex] = treeIndex;
  }

  for (let treeIndex = tree.length - hashedValues.length - 1; treeIndex >= 0; treeIndex -= 1) {
    tree[treeIndex] = hashPair(tree[(2 * treeIndex) + 1], tree[(2 * treeIndex) + 2]);
  }

  const claimsWithProofs = claims.map((claim, valueIndex) => {
    let treeIndex = claimTreeIndices[valueIndex];
    const proof = [];

    while (treeIndex > 0) {
      const siblingIndex = treeIndex % 2 === 0 ? treeIndex - 1 : treeIndex + 1;
      proof.push(tree[siblingIndex]);
      treeIndex = Math.floor((treeIndex - 1) / 2);
    }

    return { ...claim, proof };
  });

  return {
    root: tree[0],
    claims: claimsWithProofs,
  };
}

function loadLocalConfig(repoRoot) {
  const configPath = path.join(repoRoot, "frontend", "config.local.json");
  if (!fs.existsSync(configPath)) {
    throw new Error("frontend/config.local.json was not found. Run npm run deploy:local first.");
  }

  return {
    config: JSON.parse(fs.readFileSync(configPath, "utf8")),
    configPath,
  };
}

function normalizeDeploymentKey(config) {
  if (config.deploymentKey) return String(config.deploymentKey).trim();
  return `${Number(config.chainId)}:${String(config.airdropAddress || "").toLowerCase()}`;
}

async function main() {
  const { ethers } = hre;
  const repoRoot = path.resolve(__dirname, "..");
  const options = parseArgs(process.argv.slice(2));

  if (!ethers.isAddress(options.account)) {
    throw new Error("--account must be a valid wallet address.");
  }
  if (!Number.isFinite(options.deadlineMinutes) || options.deadlineMinutes <= 0) {
    throw new Error("--deadline-minutes must be a positive number.");
  }

  const account = ethers.getAddress(options.account);
  const claimIndex = BigInt(options.index);
  const { config } = loadLocalConfig(repoRoot);
  const [deployer] = await ethers.getSigners();
  const token = await ethers.getContractAt("MockERC20", config.tokenAddress);
  const airdrop = await ethers.getContractAt("EpochMerkleAirdrop", config.airdropAddress);
  const decimals = Number(await token.decimals());
  const amountRaw = ethers.parseUnits(options.amount, decimals);
  const claims = [
    {
      index: claimIndex,
      account,
      amount: String(options.amount),
      amountRaw,
    },
  ];
  const tree = buildTree(claims);
  const latestBlock = await ethers.provider.getBlock("latest");
  const deadline = BigInt(latestBlock.timestamp + Math.floor(options.deadlineMinutes * 60));

  const mintTx = await token.mint(deployer.address, amountRaw);
  await mintTx.wait();

  const fundTx = await token.transfer(config.airdropAddress, amountRaw);
  await fundTx.wait();

  const gasFundTx = await deployer.sendTransaction({
    to: account,
    value: ethers.parseEther("10"),
  });
  await gasFundTx.wait();

  const startTx = await airdrop.startNewAirdrop(tree.root, deadline);
  const receipt = await startTx.wait();
  const epoch = Number(await airdrop.currentEpoch());
  const startedBlock = await ethers.provider.getBlock(receipt.blockNumber);
  const now = new Date().toISOString();
  const roundId = epoch;
  const claim = tree.claims[0];
  const seed = {
    version: 1,
    deploymentKey: normalizeDeploymentKey(config),
    generatedAt: now,
    round: {
      id: roundId,
      deploymentKey: normalizeDeploymentKey(config),
      status: "deployed",
      epoch,
      merkleRoot: tree.root,
      deadline: Number(deadline),
      claimCount: claims.length,
      totalAmountRaw: amountRaw.toString(),
      decimals,
      chainId: Number(config.chainId),
      contractAddress: String(config.airdropAddress).toLowerCase(),
      sourceKind: "local-hardhat-demo",
      startTxHash: receipt.hash,
      startBlockNumber: receipt.blockNumber,
      startBlockHash: startedBlock.hash,
      createdAt: now,
      updatedAt: now,
    },
    claims: [
      {
        id: 1,
        roundId,
        index: claim.index.toString(),
        account: claim.account,
        amount: claim.amount,
        amountRaw: claim.amountRaw.toString(),
        proof: claim.proof,
        usernameDisplay: "Local demo",
        claimedAt: null,
        claimedTxHash: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
  };

  const outputPath = path.join(repoRoot, "frontend", "demo-claim.local.json");
  fs.writeFileSync(outputPath, `${JSON.stringify(seed, null, 2)}\n`);

  console.log("Local claim seeded.");
  console.log(`Account:     ${account}`);
  console.log(`Amount:      ${options.amount} LIB`);
  console.log(`Epoch:       ${epoch}`);
  console.log(`Merkle root: ${tree.root}`);
  console.log(`Airdrop:     ${config.airdropAddress}`);
  console.log(`Seed file:   ${outputPath}`);
}

main().catch((error) => {
  console.error(error.message || String(error));
  usage();
  process.exitCode = 1;
});
