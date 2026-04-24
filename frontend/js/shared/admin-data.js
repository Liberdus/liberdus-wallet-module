import { normalizeAddress } from "./format.js";
import { ADMIN_STORAGE_KEY } from "./constants.js";

function nowIso() {
  return new Date().toISOString();
}

function normalizeIsoDate(value, fallbackValue = null) {
  const rawValue = String(value || "").trim();
  if (!rawValue) return fallbackValue;

  const parsed = new Date(rawValue);
  if (Number.isNaN(parsed.getTime())) return fallbackValue;
  return parsed.toISOString();
}

function normalizeUsername(value) {
  return String(value || "").trim().replace(/^@+/u, "").toLowerCase();
}

function normalizeUsernameDisplay(value) {
  return String(value || "").trim().replace(/^@+/u, "");
}

function parseBoolean(value) {
  const rawValue = String(value ?? "").trim().toLowerCase();
  return rawValue === "true" || rawValue === "1" || rawValue === "yes" || rawValue === "y";
}

function parseInteger(value, fallbackValue = 0) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallbackValue;
}

function createEmptyState() {
  return {
    version: 1,
    nextAccountId: 1,
    accounts: [],
    recoverySubmissions: [],
  };
}

function readState() {
  try {
    const rawValue = window.localStorage.getItem(ADMIN_STORAGE_KEY);
    if (!rawValue) return createEmptyState();

    const parsed = JSON.parse(rawValue);
    return {
      version: 1,
      nextAccountId: Number(parsed?.nextAccountId || 1),
      accounts: Array.isArray(parsed?.accounts) ? parsed.accounts : [],
      recoverySubmissions: Array.isArray(parsed?.recoverySubmissions) ? parsed.recoverySubmissions : [],
    };
  } catch {
    return createEmptyState();
  }
}

function writeState(state) {
  window.localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(state));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeSnapshotHistory(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => normalizeIsoDate(value)).filter(Boolean))].sort();
}

function parseSnapshotHistory(rawValue) {
  try {
    const parsed = JSON.parse(String(rawValue || "[]"));
    return normalizeSnapshotHistory(parsed);
  } catch {
    return [];
  }
}

function resolveSnapshotState(existingAccount, input, updatedAt) {
  const existingHistory = normalizeSnapshotHistory(existingAccount?.snapshotHistory);
  const explicitHistory = input.snapshotHistory ? normalizeSnapshotHistory(input.snapshotHistory) : null;
  let history = explicitHistory || existingHistory;

  const snapshotCapturedAt = normalizeIsoDate(input.snapshotCapturedAt);
  if (snapshotCapturedAt) {
    history = normalizeSnapshotHistory([...history, snapshotCapturedAt]);
  }

  const isFollower = Boolean(input.isFollower ?? existingAccount?.isFollower);
  if (isFollower && !history.length) {
    history = [updatedAt];
  }

  const firstSeenFollowingAt = normalizeIsoDate(
    input.firstSeenFollowingAt,
    existingAccount?.firstSeenFollowingAt || history[0] || null,
  );
  const lastSeenFollowingAt = normalizeIsoDate(
    input.lastSeenFollowingAt,
    existingAccount?.lastSeenFollowingAt || history[history.length - 1] || null,
  );
  const latestSnapshotCapturedAt = normalizeIsoDate(
    input.latestSnapshotCapturedAt,
    existingAccount?.latestSnapshotCapturedAt || history[history.length - 1] || null,
  );

  return {
    snapshotHistory: history,
    firstSeenFollowingAt,
    lastSeenFollowingAt,
    snapshotsSeenCount: parseInteger(
      input.snapshotsSeenCount,
      existingAccount?.snapshotsSeenCount || history.length || 0,
    ),
    latestSnapshotCapturedAt,
  };
}

function toAccountResponse(account) {
  return clone({
    id: Number(account.id),
    xUserId: String(account.xUserId || "").trim(),
    username: String(account.username || "").trim(),
    usernameDisplay: String(account.username || "").trim(),
    walletAddress: String(account.walletAddress || "").trim(),
    walletSource: String(account.walletSource || "").trim(),
    isFollower: Boolean(account.isFollower),
    needsRecovery: Boolean(account.needsRecovery),
    firstSeenFollowingAt: normalizeIsoDate(account.firstSeenFollowingAt),
    lastSeenFollowingAt: normalizeIsoDate(account.lastSeenFollowingAt),
    snapshotsSeenCount: Number(account.snapshotsSeenCount || 0),
    latestSnapshotCapturedAt: normalizeIsoDate(account.latestSnapshotCapturedAt),
    snapshotHistory: normalizeSnapshotHistory(account.snapshotHistory),
    createdAt: normalizeIsoDate(account.createdAt),
    updatedAt: normalizeIsoDate(account.updatedAt),
  });
}

function findAccountIndex(state, { xUserId, username }) {
  const normalizedUserId = String(xUserId || "").trim();
  const normalizedUsername = normalizeUsername(username);

  return state.accounts.findIndex((account) => (
    (normalizedUserId && String(account.xUserId || "").trim() === normalizedUserId)
    || (normalizedUsername && normalizeUsername(account.username) === normalizedUsername)
  ));
}

function saveAccountInState(state, input = {}) {
  const updatedAt = normalizeIsoDate(input.updatedAt, nowIso());
  const username = normalizeUsernameDisplay(
    input.username
    || input.usernameDisplay
    || input.usernameNorm
    || "",
  );
  const xUserId = String(input.xUserId || "").trim();
  if (!username && !xUserId) {
    throw new Error("Account row requires an X user id or username.");
  }

  const existingIndex = findAccountIndex(state, { xUserId, username });
  const existingAccount = existingIndex >= 0 ? state.accounts[existingIndex] : null;
  const rawWalletAddress = String(input.walletAddress || "").trim();
  const walletAddress = normalizeAddress(rawWalletAddress) || rawWalletAddress;
  const snapshotState = resolveSnapshotState(existingAccount, input, updatedAt);
  const nextAccount = {
    id: existingAccount?.id || Number(state.nextAccountId || 1),
    xUserId: xUserId || existingAccount?.xUserId || "",
    username: username || existingAccount?.username || xUserId,
    walletAddress: walletAddress || existingAccount?.walletAddress || "",
    walletSource: rawWalletAddress ? (input.walletSource || existingAccount?.walletSource || "form") : (existingAccount?.walletSource || ""),
    isFollower: Boolean(input.isFollower ?? existingAccount?.isFollower ?? false),
    needsRecovery: Boolean(input.needsRecovery ?? existingAccount?.needsRecovery ?? false),
    ...snapshotState,
    createdAt: existingAccount?.createdAt || updatedAt,
    updatedAt,
  };

  if (existingIndex >= 0) {
    state.accounts[existingIndex] = nextAccount;
  } else {
    state.nextAccountId = Number(state.nextAccountId || 1) + 1;
    state.accounts.push(nextAccount);
  }

  return toAccountResponse(nextAccount);
}

function parseCsvRows(csvText) {
  const rows = [];
  let current = [];
  let field = "";
  let inQuotes = false;

  const pushField = () => {
    current.push(field);
    field = "";
  };
  const pushRow = () => {
    if (current.length || field) {
      pushField();
      rows.push(current);
    }
    current = [];
  };

  const text = String(csvText || "").replace(/^\uFEFF/u, "");
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === "\"") {
      if (inQuotes && nextChar === "\"") {
        field += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      pushField();
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      pushRow();
      continue;
    }

    field += char;
  }

  pushRow();
  if (!rows.length) return [];

  const headers = rows[0].map((header) => String(header || "").trim());
  return rows.slice(1)
    .filter((row) => row.some((value) => String(value || "").trim()))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, String(row[index] || "").trim()])));
}

function normalizeAccountCsvRow(row) {
  return {
    username: row.x_username || row.username || row.api_username || "",
    xUserId: row.x_user_id || row.user_id || row.api_user_id || "",
    walletAddress: row.wallet_address || "",
    walletSource: String(row.wallet_address || "").trim() ? "form" : "",
    isFollower: parseBoolean(row.is_follower),
    needsRecovery: parseBoolean(row.needs_recovery),
    snapshotHistory: parseSnapshotHistory(row.snapshot_history_json),
    firstSeenFollowingAt: normalizeIsoDate(row.first_seen_following_at),
    lastSeenFollowingAt: normalizeIsoDate(row.last_seen_following_at),
    snapshotsSeenCount: parseInteger(row.snapshots_seen_count, undefined),
    latestSnapshotCapturedAt: normalizeIsoDate(row.latest_snapshot_captured_at),
  };
}

function buildPagination(items, options = {}) {
  const requestedPageSize = parseInteger(options.pageSize, 50);
  const pageSize = Math.min(Math.max(requestedPageSize || 50, 1), 200);
  const total = items.length;
  const totalPages = total > 0 ? Math.ceil(total / pageSize) : 0;
  const requestedPage = parseInteger(options.page, 1);
  const page = totalPages > 0 ? Math.min(Math.max(requestedPage, 1), totalPages) : 1;
  const offset = (page - 1) * pageSize;

  return {
    page,
    pageSize,
    total,
    totalPages,
    hasNextPage: totalPages > 0 && page < totalPages,
    hasPreviousPage: page > 1,
    rows: items.slice(offset, offset + pageSize),
  };
}

function getSummary(state) {
  const latestSnapshotCapturedAt = state.accounts
    .map((account) => normalizeIsoDate(account.latestSnapshotCapturedAt))
    .filter(Boolean)
    .sort()
    .at(-1) || null;

  return {
    accountCount: state.accounts.length,
    followerCount: state.accounts.filter((account) => account.isFollower).length,
    recoveryCandidateCount: state.accounts.filter((account) => account.needsRecovery).length,
    latestSnapshotCapturedAt,
    recoverySubmissionCount: state.recoverySubmissions.length,
  };
}

function withSummary(state, payload = {}) {
  return {
    ...payload,
    summary: getSummary(state),
  };
}

function toSubmissionResponse(submission, { includeSecrets = false } = {}) {
  const response = {
    id: String(submission.id || "").trim(),
    accountId: submission.accountId == null ? null : Number(submission.accountId),
    xUserId: String(submission.xUserId || "").trim(),
    usernameAtSubmission: String(submission.usernameAtSubmission || "").trim(),
    walletAddress: String(submission.walletAddress || "").trim(),
    wasKnownFollower: Boolean(submission.wasKnownFollower),
    wasRecoveryCandidate: Boolean(submission.wasRecoveryCandidate),
    status: String(submission.status || "").trim(),
    submittedAt: normalizeIsoDate(submission.submittedAt),
    createdAt: normalizeIsoDate(submission.createdAt),
  };

  if (includeSecrets) {
    response.signedMessage = String(submission.signedMessage || "").trim();
    response.signature = String(submission.signature || "").trim();
  }

  return clone(response);
}

function saveRecoverySubmission(state, input = {}) {
  const submittedAt = normalizeIsoDate(input.updatedAt || input.submittedAt || input.createdAt, nowIso());
  const username = normalizeUsernameDisplay(input.xUsername || input.usernameAtSubmission || input.username || "");
  const xUserId = String(input.xUserId || "").trim();
  const walletAddress = normalizeAddress(input.walletAddress) || String(input.walletAddress || "").trim();
  const existing = state.recoverySubmissions.find((submission) => submission.id === input.id);
  if (existing) return toSubmissionResponse(existing);

  const account = saveAccountInState(state, {
    username,
    xUserId,
    walletAddress,
    walletSource: walletAddress ? "recovery" : "",
    isFollower: Boolean(input.isKnownFollower ?? input.wasKnownFollower),
    needsRecovery: Boolean(input.isRecoveryCandidate ?? input.wasRecoveryCandidate),
    updatedAt: submittedAt,
  });

  const submission = {
    id: String(input.id || createId()).trim(),
    accountId: account.id,
    xUserId,
    usernameAtSubmission: username,
    walletAddress,
    signedMessage: String(input.signedMessage || "").trim(),
    signature: String(input.signature || "").trim(),
    wasKnownFollower: Boolean(input.isKnownFollower ?? input.wasKnownFollower),
    wasRecoveryCandidate: Boolean(input.isRecoveryCandidate ?? input.wasRecoveryCandidate),
    status: String(input.status || "received").trim() || "received",
    submittedAt,
    createdAt: normalizeIsoDate(input.createdAt, submittedAt),
  };
  state.recoverySubmissions.push(submission);
  return toSubmissionResponse(submission);
}

function quoteCsvValue(value) {
  const rawValue = String(value ?? "");
  if (!/[",\r\n]/u.test(rawValue)) return rawValue;
  return `"${rawValue.replace(/"/g, "\"\"")}"`;
}

function exportRecoveryJson(submissions) {
  return JSON.stringify({
    records: submissions.map((submission) => ({
      id: submission.id,
      xUserId: submission.xUserId,
      xUsername: submission.usernameAtSubmission,
      walletAddress: submission.walletAddress,
      signedMessage: submission.signedMessage,
      signature: submission.signature,
      isKnownFollower: submission.wasKnownFollower,
      isRecoveryCandidate: submission.wasRecoveryCandidate,
      status: submission.status,
      createdAt: submission.createdAt,
      updatedAt: submission.submittedAt,
    })),
  }, null, 2);
}

function exportRecoveryCsv(submissions) {
  const headers = [
    "id",
    "x_user_id",
    "username_at_submission",
    "wallet_address",
    "signed_message",
    "signature",
    "was_known_follower",
    "was_recovery_candidate",
    "status",
    "submitted_at",
    "created_at",
  ];
  const rows = submissions.map((submission) => [
    submission.id,
    submission.xUserId,
    submission.usernameAtSubmission,
    submission.walletAddress,
    submission.signedMessage,
    submission.signature,
    submission.wasKnownFollower,
    submission.wasRecoveryCandidate,
    submission.status,
    submission.submittedAt,
    submission.createdAt,
  ].map(quoteCsvValue).join(","));

  return [headers.join(","), ...rows].join("\n");
}

export async function fetchAdminAccounts(config, options = {}) {
  const state = readState();
  const search = String(options.search || options.query || "").trim().toLowerCase();
  const walletOnly = Boolean(options.walletOnly);
  const accounts = state.accounts
    .map((account) => toAccountResponse(account))
    .filter((account) => {
      if (walletOnly && !String(account.walletAddress || "").trim()) return false;
      if (!search) return true;
      return [
        account.username,
        account.xUserId,
        account.walletAddress,
      ].some((value) => String(value || "").toLowerCase().includes(search));
    })
    .sort((left, right) => String(left.username || "").localeCompare(String(right.username || "")));
  const pagination = buildPagination(accounts, options);
  return withSummary(state, {
    accounts: pagination.rows,
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total: pagination.total,
      totalPages: pagination.totalPages,
      hasNextPage: pagination.hasNextPage,
      hasPreviousPage: pagination.hasPreviousPage,
    },
  });
}

export async function importAdminAccounts(config, payload = {}) {
  const state = readState();
  const rows = parseCsvRows(payload.content || "");
  let importedCount = 0;
  for (const row of rows) {
    saveAccountInState(state, {
      ...normalizeAccountCsvRow(row),
      updatedAt: nowIso(),
    });
    importedCount += 1;
  }

  writeState(state);
  return withSummary(state, {
    importedCount,
  });
}

export async function saveAdminAccount(config, payload = {}) {
  const state = readState();
  const account = saveAccountInState(state, {
    username: payload.username,
    xUserId: payload.xUserId,
    walletAddress: payload.walletAddress,
    walletSource: payload.walletAddress ? "form" : "",
    isFollower: Boolean(payload.isFollower),
    needsRecovery: Boolean(payload.needsRecovery),
    updatedAt: nowIso(),
  });

  writeState(state);
  return withSummary(state, {
    account,
  });
}

export async function fetchAdminRecoverySubmissions(config, options = {}) {
  const state = readState();
  const search = String(options.search || options.query || "").trim().toLowerCase();
  const submissions = state.recoverySubmissions
    .map((submission) => toSubmissionResponse(submission))
    .filter((submission) => {
      if (!search) return true;
      return [
        submission.usernameAtSubmission,
        submission.xUserId,
        submission.walletAddress,
      ].some((value) => String(value || "").toLowerCase().includes(search));
    })
    .sort((left, right) => String(right.submittedAt || "").localeCompare(String(left.submittedAt || "")));
  const pagination = buildPagination(submissions, options);
  return withSummary(state, {
    submissions: pagination.rows,
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total: pagination.total,
      totalPages: pagination.totalPages,
      hasNextPage: pagination.hasNextPage,
      hasPreviousPage: pagination.hasPreviousPage,
    },
  });
}

export async function importAdminRecoverySubmissions(config, payload = {}) {
  const state = readState();
  let parsed;
  try {
    parsed = JSON.parse(String(payload.content || "{}"));
  } catch {
    throw new Error("Recovery submissions JSON must be valid JSON.");
  }

  const records = Array.isArray(parsed?.records) ? parsed.records : [];
  let importedCount = 0;
  for (const record of records) {
    const beforeCount = state.recoverySubmissions.length;
    saveRecoverySubmission(state, record);
    if (state.recoverySubmissions.length > beforeCount) {
      importedCount += 1;
    }
  }

  writeState(state);
  return withSummary(state, {
    importedCount,
  });
}

export async function exportAdminRecoverySubmissions(config, format = "json") {
  const state = readState();
  const normalizedFormat = String(format || "json").trim().toLowerCase();
  const submissions = state.recoverySubmissions
    .map((submission) => toSubmissionResponse(submission, { includeSecrets: true }))
    .sort((left, right) => String(right.submittedAt || "").localeCompare(String(left.submittedAt || "")));

  if (normalizedFormat === "csv") {
    return {
      fileName: "recovery-submissions.csv",
      contentType: "text/csv",
      content: exportRecoveryCsv(submissions),
    };
  }

  return {
    fileName: "recovery-submissions.json",
    contentType: "application/json",
    content: exportRecoveryJson(submissions),
  };
}
