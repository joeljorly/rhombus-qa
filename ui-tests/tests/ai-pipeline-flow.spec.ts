import { test, expect } from "@playwright/test";
import path from "path";

// path to our messy CSV test file
const TEST_CSV = path.resolve(__dirname, "../../test-data/messy_data.csv");

// credentials come from .env (loaded by playwright.config.ts)
const EMAIL = process.env.RHOMBUS_EMAIL!;
const PASSWORD = process.env.RHOMBUS_PASSWORD!;

test.describe("Rhombus AI - AI Pipeline Flow", () => {
  test("should sign in, upload CSV, run AI pipeline, preview and download results", async ({
    page,
  }) => {
    // ── Step 1: Navigate to login ──
    await page.goto("/");
    await page.click('text=Log In');

    // wait for the Auth0 login page to load
    await page.waitForURL(/auth\.rhombusai\.com/, { timeout: 15_000 });

    // ── Step 2: Sign in with email and password ──
    await page.fill('input[name="email"], input[type="email"]', EMAIL);
    await page.fill('input[name="password"], input[type="password"]', PASSWORD);
    await page.click('button:has-text("Log In")');

    // wait for redirect back to the dashboard
    await page.waitForURL(/rhombusai\.com/, { timeout: 30_000 });

    // verify we're logged in — sidebar should show email or dashboard content
    await expect(
      page.locator("text=Dashboard").first()
    ).toBeVisible({ timeout: 15_000 });

    // ── Step 3: Upload messy CSV and send prompt ──
    // click the attach/upload area and upload the file
    const fileInput = page.locator('input[type="file"]');

    // the file input might be hidden, so we use setInputFiles directly
    await fileInput.setInputFiles(TEST_CSV);

    // type the transformation prompt
    const promptArea = page.locator(
      'textarea, [contenteditable="true"], input[placeholder*="prompt" i], input[placeholder*="attach" i]'
    ).first();
    await promptArea.waitFor({ state: "visible", timeout: 10_000 });
    await promptArea.click();
    await promptArea.fill(
      "Remove duplicate rows and standardize text casing to lowercase"
    );

    // click the send button
    const sendButton = page.locator(
      'button[type="submit"], button:has(svg), button[aria-label*="send" i]'
    ).last();
    await sendButton.click();

    // ── Step 4: Handle clarification popup if it appears ──
    try {
      const clarifyDialog = page.locator("text=Clarify Request");
      await clarifyDialog.waitFor({ state: "visible", timeout: 15_000 });

      // if clarification popup appeared, fill it in
      const clarifyInput = page.locator(
        'textarea[placeholder*="missing detail" i], textarea'
      ).last();
      await clarifyInput.fill(
        "Remove exact duplicate rows and convert all text columns to lowercase"
      );

      await page.click('button:has-text("Continue")');
    } catch {
      // no clarification popup — that's fine, continue
      console.log("No clarification popup detected, continuing...");
    }

    // ── Step 5: Wait for pipeline to finish ──
    // the "Run Pipeline" button appears when pipeline is built
    // and "Cancel Pipeline" appears during execution
    // wait for the pipeline canvas to appear with nodes
    await expect(
      page.locator('text=Data Input').first()
    ).toBeVisible({ timeout: 60_000 });

    // check if pipeline needs to be run manually or runs automatically
    const runPipelineBtn = page.locator('button:has-text("Run Pipeline")');
    const cancelPipelineBtn = page.locator(
      'button:has-text("Cancel Pipeline")'
    );

    // if "Cancel Pipeline" is visible, pipeline is already running
    const isRunning = await cancelPipelineBtn.isVisible().catch(() => false);

    if (!isRunning) {
      // check if Run Pipeline is available
      const canRun = await runPipelineBtn.isVisible().catch(() => false);
      if (canRun) {
        await runPipelineBtn.click();
      }
    }

    // wait for pipeline to complete: "Run Pipeline" should reappear
    await expect(runPipelineBtn).toBeVisible({ timeout: 90_000 });

    // ── Step 6: Preview the output ──
    const previewTab = page.locator(
      'button:has-text("Preview"), [role="tab"]:has-text("Preview")'
    ).first();
    await previewTab.click();

    // verify we see the data table with results
    await expect(
      page.locator("text=Node Preview").first()
    ).toBeVisible({ timeout: 15_000 });

    // verify we see table rows with actual data
    // the cleaned data should have lowercase names
    await expect(
      page.locator("table, [role='grid'], [class*='table']").first()
    ).toBeVisible({ timeout: 10_000 });

    // check that data is actually displayed — look for at least one data cell
    const firstDataCell = page.locator(
      "td, [role='cell'], [role='gridcell']"
    ).first();
    await expect(firstDataCell).toBeVisible({ timeout: 10_000 });

    // ── Step 7: Download the results ──
    const downloadButton = page.locator(
      'button:has-text("Download")'
    ).first();
    await expect(downloadButton).toBeVisible({ timeout: 10_000 });

    // set up download listener before clicking
    const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
    await downloadButton.click();

    // if a dropdown appears with format options, click CSV
    try {
      const csvOption = page.locator(
        'text=CSV, button:has-text("CSV"), [role="menuitem"]:has-text("CSV")'
      ).first();
      await csvOption.waitFor({ state: "visible", timeout: 3_000 });
      await csvOption.click();
    } catch {
      // no dropdown — download started directly
    }

    const download = await downloadPromise;

    // save the downloaded file
    const downloadPath = path.resolve(
      __dirname,
      "../../test-data/output_cleaned.csv"
    );
    await download.saveAs(downloadPath);

    // verify the file was actually downloaded
    const fs = await import("fs");
    expect(fs.existsSync(downloadPath)).toBeTruthy();

    // read the file and do basic checks
    const content = fs.readFileSync(downloadPath, "utf-8");
    const lines = content.trim().split("\n");

    // should have a header row + data rows
    expect(lines.length).toBeGreaterThan(1);

    // header should contain expected columns
    const header = lines[0].toLowerCase();
    expect(header).toContain("name");
    expect(header).toContain("age");
    expect(header).toContain("email");

    // data should be lowercased (checking first data row)
    const firstRow = lines[1];
    expect(firstRow).toBe(firstRow.toLowerCase());

    // should have fewer rows than input (20 data rows) due to deduplication
    expect(lines.length - 1).toBeLessThan(20);

    console.log(`Download verified: ${lines.length - 1} data rows in output`);
  });
});
