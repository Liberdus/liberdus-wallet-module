const fs = require("node:fs");
const path = require("node:path");

const { expect, test } = require("../../fixtures/testWithMockWallet");
const { connectViaWalletPicker } = require("../helpers");

const UI_STORAGE_KEY = "liberdus-wallet-module:ui-config";
const WALLET_SESSION_KEY = "liberdus-wallet-module:wallet-session";
const CLAIMS_STORAGE_KEY = "liberdus-wallet-module:claims:v1";
const ADMIN_STORAGE_KEY = "liberdus-wallet-module:admin:v1";
const EXTRA_NAMESPACED_STORAGE_KEY = "liberdus-wallet-module:test-extra";
const LEGACY_ADMIN_STORAGE_KEY = "liberdus-airdrop-local-admin-v1";

function writeFixtureFile(testInfo, name, content) {
  const filePath = testInfo.outputPath(name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

test("admin can manage accounts and recovery submissions from the accounts tab", async ({ page, mockWallet }, testInfo) => {
  const accountsCsvPath = writeFixtureFile(testInfo, "accounts.csv", [
    "x_username,wallet_address,x_user_id,is_follower,needs_recovery,snapshot_history_json",
    "alpha,0x70997970c51812dc3a010c7d01b50e0d17dc79c8,111,true,false,\"[\"\"2026-04-01T12:00:00.000Z\"\", \"\"2026-04-15T12:00:00.000Z\"\"]\"",
    "beta,,222,false,true,",
  ].join("\n"));
  const recoveryJsonPath = writeFixtureFile(testInfo, "recovery-links.json", JSON.stringify({
    records: [
      {
        id: "submission-1",
        xUserId: "333",
        xUsername: "gamma",
        walletAddress: "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
        signedMessage: "Signed test message",
        signature: "0xdeadbeef",
        isKnownFollower: true,
        isRecoveryCandidate: true,
        status: "received",
        updatedAt: "2026-04-18T15:45:00.000Z",
        createdAt: "2026-04-18T15:45:00.000Z",
      },
    ],
  }, null, 2));

  await page.goto("admin.html");
  await connectViaWalletPicker(page);
  await mockWallet.failNextRequest(page, "personal_sign", {
    message: "Accounts tab should not request an admin signature.",
  });

  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await expect(page.locator("#accountsPaginationLabel")).toContainText("0 accounts");

  await page.locator("#accountsImportFileInput").setInputFiles(accountsCsvPath);
  await page.getByRole("button", { name: "Upload Accounts" }).click();

  await expect(page.locator("#managementAccountCount")).toHaveText("2");
  await expect(page.locator("#managementFollowerCount")).toHaveText("1");
  await expect(page.locator("#managementRecoveryCandidateCount")).toHaveText("1");
  await expect(page.locator("#accountsTableBody")).toContainText("alpha");
  await expect(page.locator("#accountsTableBody")).toContainText("beta");
  const alphaRow = page.locator("#accountsTableBody tr").filter({ hasText: "alpha" }).first();
  await expect(alphaRow).toContainText("2");
  await expect(alphaRow).toContainText("First:");
  await expect(alphaRow).not.toContainText("No snapshot");

  await page.locator("#singleAccountUsernameInput").fill("gamma");
  await page.locator("#singleAccountUserIdInput").fill("333");
  await page.locator("#singleAccountNeedsRecoveryInput").check();
  await page.locator("#singleAccountIsFollowerInput").check();
  await page.getByRole("button", { name: "Save Account" }).click();

  await expect(page.locator("#managementAccountCount")).toHaveText("3");

  await page.locator("#accountsSearchInput").fill("gamma");
  await page.getByRole("button", { name: "Apply" }).first().click();
  await expect(page.locator("#accountsTableBody")).toContainText("gamma");

  await page.locator("#recoveryImportFileInput").setInputFiles(recoveryJsonPath);
  await page.getByRole("button", { name: "Upload Recovery JSON" }).click();

  await expect(page.locator("#managementSubmissionCount")).toHaveText("1");
  await expect(page.locator("#recoverySubmissionsBody")).toContainText("gamma");
  await expect(page.locator("#recoverySubmissionsBody")).toContainText("received");

  const jsonDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  const jsonDownload = await jsonDownloadPromise;
  const jsonPath = testInfo.outputPath("recovery-export.json");
  await jsonDownload.saveAs(jsonPath);
  const jsonContent = fs.readFileSync(jsonPath, "utf8");
  expect(jsonContent).toContain("\"xUsername\": \"gamma\"");
  expect(jsonContent).toContain("\"signature\": \"0xdeadbeef\"");

  const csvDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const csvDownload = await csvDownloadPromise;
  const csvPath = testInfo.outputPath("recovery-export.csv");
  await csvDownload.saveAs(csvPath);
  const csvContent = fs.readFileSync(csvPath, "utf8");
  expect(csvContent).toContain("username_at_submission");
  expect(csvContent).toContain("gamma");
  expect(csvContent).toContain("0xdeadbeef");
});

test("admin can clear wallet module local storage after confirmation", async ({ page }) => {
  const keys = [
    UI_STORAGE_KEY,
    WALLET_SESSION_KEY,
    CLAIMS_STORAGE_KEY,
    ADMIN_STORAGE_KEY,
    EXTRA_NAMESPACED_STORAGE_KEY,
    LEGACY_ADMIN_STORAGE_KEY,
  ];

  await page.goto("admin.html");
  await connectViaWalletPicker(page);
  await expect(page.getByText("Owner wallet detected. Admin controls are unlocked.")).toBeVisible();

  await page.evaluate((storageKeys) => {
    for (const key of storageKeys) {
      window.localStorage.setItem(key, JSON.stringify({ key }));
    }
  }, keys);

  await page.getByRole("button", { name: "Clear Local Storage" }).click();
  const dialog = page.getByRole("dialog", { name: "Clear Local Storage?" });
  await expect(dialog).toBeVisible();

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => page.evaluate((key) => window.localStorage.getItem(key), ADMIN_STORAGE_KEY))
    .not.toBeNull();

  await page.getByRole("button", { name: "Clear Local Storage" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Clear Local Storage" }).click();

  await expect(dialog).toBeHidden();
  await expect(page.locator("#accountRole")).toHaveText("Disconnected");
  await expect.poll(async () => page.evaluate((storageKeys) => (
    storageKeys.map((key) => window.localStorage.getItem(key))
  ), keys)).toEqual(keys.map(() => null));
});
