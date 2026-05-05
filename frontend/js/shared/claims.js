import { normalizeAddress } from "./format.js";
import { buildClaimRound } from "./merkle.js";
import { CLAIMS_STORAGE_KEY, UI_ROOT } from "./constants.js";

function nowIso() {
  return new Date().toISOString();
}

function normalizeDeploymentKey(config = {}) {
  const explicitKey = String(config?.deploymentKey || "").trim();
  if (explicitKey) return explicitKey;

  const chainId = Number(config?.chainId || 0);
  const airdropAddress = normalizeAddress(config?.airdropAddress || "");
  if (chainId && airdropAddress) {
    return `${chainId}:${airdropAddress.toLowerCase()}`;
  }

  return "local-browser";
}

function createEmptyState() {
  return {
    version: 1,
    deployments: {},
  };
}

function readState() {
  try {
    const rawValue = window.localStorage.getItem(CLAIMS_STORAGE_KEY);
    if (!rawValue) return createEmptyState();

    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== "object") return createEmptyState();
    return {
      version: 1,
      deployments: parsed.deployments && typeof parsed.deployments === "object"
        ? parsed.deployments
        : {},
    };
  } catch {
    return createEmptyState();
  }
}

function writeState(state) {
  window.localStorage.setItem(CLAIMS_STORAGE_KEY, JSON.stringify(state));
}

function createEmptyDeployment() {
  return {
    nextRoundId: 1,
    nextClaimId: 1,
    rounds: [],
    claimsByRound: {},
  };
}

function getDeployment(state, config = {}) {
  const deploymentKey = normalizeDeploymentKey(config);
  const current = state.deployments[deploymentKey];
  if (current && typeof current === "object") {
    current.nextRoundId = Number(current.nextRoundId || 1);
    current.nextClaimId = Number(current.nextClaimId || 1);
    current.rounds = Array.isArray(current.rounds) ? current.rounds : [];
    current.claimsByRound = current.claimsByRound && typeof current.claimsByRound === "object"
      ? current.claimsByRound
      : {};
    return current;
  }

  const nextDeployment = createEmptyDeployment();
  state.deployments[deploymentKey] = nextDeployment;
  return nextDeployment;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeRoundForStorage(round) {
  return {
    id: Number(round.id),
    deploymentKey: String(round.deploymentKey || "").trim(),
    status: String(round.status || "draft").trim(),
    epoch: round.epoch == null ? null : Number(round.epoch),
    merkleRoot: String(round.merkleRoot || "").trim().toLowerCase(),
    deadline: Number(round.deadline || 0),
    claimCount: Number(round.claimCount || 0),
    totalAmountRaw: String(round.totalAmountRaw || "0"),
    decimals: Number(round.decimals || 18),
    chainId: Number(round.chainId || 0),
    contractAddress: normalizeAddress(round.contractAddress || "")?.toLowerCase() || "",
    sourceKind: String(round.sourceKind || "local-browser").trim(),
    startTxHash: String(round.startTxHash || "").trim().toLowerCase() || "",
    startBlockNumber: round.startBlockNumber == null ? null : Number(round.startBlockNumber),
    startBlockHash: String(round.startBlockHash || "").trim().toLowerCase() || "",
    createdAt: round.createdAt || nowIso(),
    updatedAt: round.updatedAt || nowIso(),
  };
}

function normalizeClaimForStorage(roundId, claim, claimId, timestamp) {
  const account = normalizeAddress(claim.account);
  if (!account) {
    throw new Error("Claim account is invalid.");
  }

  return {
    id: Number(claim.id || claimId),
    roundId: Number(roundId),
    index: String(claim.index),
    account,
    amountRaw: String(claim.amountRaw || "0"),
    proof: Array.isArray(claim.proof) ? [...claim.proof] : [],
    usernameDisplay: String(claim.usernameDisplay || "").trim() || null,
    claimedAt: claim.claimedAt || null,
    claimedTxHash: String(claim.claimedTxHash || "").trim().toLowerCase() || null,
    createdAt: claim.createdAt || timestamp,
    updatedAt: claim.updatedAt || timestamp,
  };
}

function toRoundResponse(round) {
  return clone(normalizeRoundForStorage(round));
}

function toClaimResponse(claim) {
  return clone(claim);
}

function toRoundClaimResponse(round, claim) {
  return {
    round: toRoundResponse(round),
    entry: toClaimResponse(claim),
  };
}

function listRoundsForDeployment(deployment) {
  return [...deployment.rounds]
    .map((round) => normalizeRoundForStorage(round))
    .sort((left, right) => {
      const leftDraft = left.status === "draft" ? 0 : 1;
      const rightDraft = right.status === "draft" ? 0 : 1;
      if (leftDraft !== rightDraft) return leftDraft - rightDraft;

      const leftEpoch = Number(left.epoch || 0);
      const rightEpoch = Number(right.epoch || 0);
      if (leftEpoch !== rightEpoch) return rightEpoch - leftEpoch;

      return String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
    });
}

function findRound(deployment, roundId) {
  return deployment.rounds.find((round) => Number(round.id) === Number(roundId)) || null;
}

function findClaimsByRound(deployment, roundId) {
  return Array.isArray(deployment.claimsByRound[String(roundId)])
    ? deployment.claimsByRound[String(roundId)]
    : [];
}

function findMatchingDraft(deployment, round) {
  return deployment.rounds.find((candidate) => (
    candidate.status === "draft"
    && String(candidate.merkleRoot || "").toLowerCase() === String(round.merkleRoot || "").toLowerCase()
    && Number(candidate.deadline || 0) === Number(round.deadline || 0)
    && Number(candidate.claimCount || 0) === Number(round.claimCount || 0)
    && String(candidate.totalAmountRaw || "0") === String(round.totalAmountRaw || "0")
  )) || null;
}

function getNextClaimId(deployment) {
  const claimId = Number(deployment.nextClaimId || 1);
  deployment.nextClaimId = claimId + 1;
  return claimId;
}

function replaceClaims(deployment, roundId, claims, timestamp) {
  deployment.claimsByRound[String(roundId)] = claims.map((claim) => (
    normalizeClaimForStorage(roundId, claim, getNextClaimId(deployment), timestamp)
  ));
}

function getClaimRecordsForWallet(deployment, walletAddress, { deployedOnly = false } = {}) {
  const normalizedWalletAddress = normalizeAddress(walletAddress);
  if (!normalizedWalletAddress) {
    throw new Error("Wallet address is invalid.");
  }

  const walletKey = normalizedWalletAddress.toLowerCase();
  const records = [];
  for (const round of listRoundsForDeployment(deployment)) {
    if (deployedOnly && round.status !== "deployed") continue;

    const claim = findClaimsByRound(deployment, round.id)
      .find((entry) => normalizeAddress(entry.account)?.toLowerCase() === walletKey);
    if (claim) {
      records.push(toRoundClaimResponse(round, claim));
    }
  }

  return records;
}

function isLocalhost() {
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
}

async function fetchLocalDemoClaimRecords(config, walletAddress) {
  if (!isLocalhost()) return [];

  try {
    const response = await fetch(new URL("./demo-claim.local.json", UI_ROOT), { cache: "no-store" });
    if (!response.ok) return [];

    const seed = await response.json();
    if (!seed || typeof seed !== "object") return [];
    if (String(seed.deploymentKey || "") !== normalizeDeploymentKey(config)) return [];

    const round = normalizeRoundForStorage(seed.round || {});
    if (round.status !== "deployed") return [];

    const normalizedWallet = normalizeAddress(walletAddress)?.toLowerCase();
    if (!normalizedWallet) return [];

    const claim = (Array.isArray(seed.claims) ? seed.claims : [])
      .map((entry) => normalizeClaimForStorage(round.id, entry, entry?.id || 1, entry?.createdAt || nowIso()))
      .find((entry) => normalizeAddress(entry.account)?.toLowerCase() === normalizedWallet);

    if (!claim) return [];

    return [toRoundClaimResponse(round, claim)];
  } catch {
    return [];
  }
}

export function isClaimsApiConfigured() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

export async function fetchWalletClaimRounds(config, walletAddress) {
  const state = readState();
  const deployment = getDeployment(state, config);
  const storedRounds = getClaimRecordsForWallet(deployment, walletAddress, { deployedOnly: true });
  const demoRounds = await fetchLocalDemoClaimRecords(config, walletAddress);
  const rounds = [...storedRounds, ...demoRounds]
    .map(({ round, entry }) => ({
      ...round,
      entry,
    }));
  return { rounds };
}

export async function fetchStoredAirdropRounds(config) {
  const state = readState();
  const deployment = getDeployment(state, config);
  return {
    rounds: listRoundsForDeployment(deployment).map((round) => toRoundResponse(round)),
  };
}

export async function fetchStoredRoundClaims(config, roundId) {
  const state = readState();
  const deployment = getDeployment(state, config);
  const round = findRound(deployment, roundId);
  if (!round) {
    throw new Error("Stored airdrop round was not found.");
  }

  return {
    round: toRoundResponse(round),
    claims: findClaimsByRound(deployment, roundId).map((claim) => toRoundClaimResponse(round, claim)),
  };
}

export async function fetchStoredClaimByEpochAndIndex(config, epoch, claimIndex) {
  const state = readState();
  const deployment = getDeployment(state, config);
  const round = deployment.rounds.find((candidate) => (
    candidate.status === "deployed" && Number(candidate.epoch) === Number(epoch)
  ));
  if (!round) return { claim: null };

  const claim = findClaimsByRound(deployment, round.id)
    .find((entry) => String(entry.index) === String(claimIndex));
  return {
    claim: claim ? toRoundClaimResponse(round, claim) : null,
  };
}

export async function fetchStoredClaimById(config, claimId) {
  const state = readState();
  const deployment = getDeployment(state, config);
  for (const round of deployment.rounds) {
    const claim = findClaimsByRound(deployment, round.id)
      .find((entry) => Number(entry.id) === Number(claimId));
    if (claim) {
      return { claim: toRoundClaimResponse(round, claim) };
    }
  }

  return { claim: null };
}

export async function fetchStoredClaimsByWallet(config, walletAddress) {
  const state = readState();
  const deployment = getDeployment(state, config);
  return {
    claims: getClaimRecordsForWallet(deployment, walletAddress),
  };
}

export async function saveAirdropRound(config, payload) {
  const state = readState();
  const deployment = getDeployment(state, config);
  const timestamp = nowIso();
  const decimals = Number(payload?.decimals || config?.tokenDecimals || 18);
  const artifact = buildClaimRound({ claims: payload?.claims || [] }, decimals);
  const deploymentKey = normalizeDeploymentKey(config);

  const nextRound = normalizeRoundForStorage({
    id: deployment.nextRoundId,
    deploymentKey,
    status: "draft",
    epoch: null,
    merkleRoot: artifact.root,
    deadline: Number(payload?.deadline || 0),
    claimCount: artifact.claimCount,
    totalAmountRaw: artifact.totalAmountRaw,
    decimals,
    chainId: Number(config?.chainId || 0),
    contractAddress: config?.airdropAddress || "",
    sourceKind: "local-admin-draft",
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const existing = findMatchingDraft(deployment, nextRound);
  const round = existing || nextRound;
  if (!existing) {
    deployment.nextRoundId = Number(deployment.nextRoundId || 1) + 1;
    deployment.rounds.push(round);
  } else {
    Object.assign(existing, {
      ...nextRound,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: timestamp,
    });
  }

  replaceClaims(deployment, round.id, artifact.claims, timestamp);
  writeState(state);

  return {
    round: toRoundResponse(round),
  };
}

export async function deploySavedAirdropRound(config, roundId, payload = {}) {
  const state = readState();
  const deployment = getDeployment(state, config);
  const round = findRound(deployment, roundId);
  if (!round) {
    throw new Error("Stored airdrop round was not found.");
  }

  const requestedEpoch = Number(payload.epoch || 0);
  const epoch = requestedEpoch > 0
    ? requestedEpoch
    : Math.max(0, ...deployment.rounds.map((candidate) => Number(candidate.epoch || 0))) + 1;
  const conflictingRound = deployment.rounds.find((candidate) => (
    Number(candidate.id) !== Number(round.id)
    && candidate.status === "deployed"
    && Number(candidate.epoch) === epoch
  ));
  if (conflictingRound) {
    throw new Error(`Epoch ${epoch} is already linked to another stored round.`);
  }

  Object.assign(round, normalizeRoundForStorage({
    ...round,
    status: "deployed",
    epoch,
    merkleRoot: payload.merkleRoot || round.merkleRoot,
    deadline: payload.deadline || round.deadline,
    chainId: payload.chainId || round.chainId || config?.chainId,
    contractAddress: payload.contractAddress || round.contractAddress || config?.airdropAddress,
    startTxHash: payload.txHash || payload.startTxHash || round.startTxHash,
    startBlockNumber: payload.startBlockNumber ?? round.startBlockNumber,
    startBlockHash: payload.startBlockHash || round.startBlockHash,
    updatedAt: nowIso(),
  }));

  writeState(state);

  return {
    round: toRoundResponse(round),
  };
}
