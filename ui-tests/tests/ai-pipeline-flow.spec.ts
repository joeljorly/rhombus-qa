import { test, expect } from "@playwright/test";
import path from "path";

// Messy CSV with duplicates, missing values, invalid dates, and mixed casing
const TEST_CSV = path.resolve(__dirname, "../../test-data/messy_data.csv");

// Credentials from .env (keeps secrets out of source code)
const EMAIL = process.env.RHOMBUS_EMAIL!;
const PASSWORD = process.env.RHOMBUS_PASSWORD!;

test.describe("Rhombus AI - AI Pipeline Flow", () => {
  test("should sign in, upload CSV, run AI pipeline, preview and download results", async ({
    page,
  }) => {
    await page.goto("https://rhombusai.com");

    // Rhombus shows a tutorial dialog on first visit that blocks the UI
    const dialog = page.locator('[role="dialog"]');
    await dialog.waitFor({ state: "visible", timeout: 10_000 });
    await dialog.locator('button:has-text("Close")').click();
    await dialog.waitFor({ state: "hidden", timeout: 5_000 });

    // Trigger the Auth0 login flow
    await page.getByRole("button", { name: "Log In" }).click();
    await page.waitForURL(/auth\.rhombusai\.com/, { timeout: 30_000 });

    // Using role-based selectors here because they survive UI redesigns
    await page.getByRole("textbox", { name: "Email address" }).fill(EMAIL);
    await page.getByRole("textbox", { name: "Password" }).fill(PASSWORD);
    await page.getByRole("button", { name: "Log In" }).click();

    // Auth0 sometimes redirects to /hub (marketing page) instead of the app
    await page.waitForURL(/rhombusai\.com/, { timeout: 30_000 });
    await page.waitForTimeout(2_000);

    if (page.url().includes("/hub")) {
      await page.goto("https://rhombusai.com", {
        waitUntil: "domcontentloaded",
      });
      await page.waitForTimeout(3_000);
    }

    if (page.url().includes("/hub")) {
      await page.goto("https://rhombusai.com/workflow", {
        waitUntil: "domcontentloaded",
      });
      await page.waitForTimeout(3_000);
    }

    // Tutorial dialog can reappear after login
    try {
      const postLoginDialog = page.locator('[role="dialog"]');
      await postLoginDialog.waitFor({ state: "visible", timeout: 5_000 });
      await postLoginDialog.locator('button:has-text("Close")').click();
      await postLoginDialog.waitFor({ state: "hidden", timeout: 5_000 });
    } catch {
      // no dialog, that's fine
    }

    await expect(
      page.locator('text=New Project').first()
    ).toBeVisible({ timeout: 15_000 });

    // Upload uses a custom dialog, not a native file input.
    // The "+" button opens an "Add New File" modal with drag-and-drop.
    const textbox = page.getByRole("textbox", { name: /Attach or drop a file/i });
    const promptParent = textbox.locator('..').locator('..');
    await promptParent.locator('button').first().click();

    const addFileDialog = page.getByRole("dialog", { name: "Add New File" });
    await expect(addFileDialog).toBeVisible({ timeout: 10_000 });

    // Try the hidden file input first (more reliable than clicking Browse Here)
    const hiddenInput = addFileDialog.locator('input[type="file"]');
    const hasHiddenInput = await hiddenInput.count();

    if (hasHiddenInput > 0) {
      await hiddenInput.setInputFiles(TEST_CSV);
    } else {
      const [fileChooser] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: 15_000 }),
        addFileDialog.locator('text=Browse Here').click(),
      ]);
      await fileChooser.setFiles(TEST_CSV);
    }

    // Attach button stays disabled until the file is fully loaded
    await page.waitForTimeout(2_000);
    const attachBtn = addFileDialog.getByRole("button", { name: "Attach" });
    await expect(attachBtn).toBeEnabled({ timeout: 10_000 });
    await attachBtn.click();
    await expect(addFileDialog).toBeHidden({ timeout: 10_000 });

    // After attaching, the placeholder changes to "What would you like to transform?"
    const promptArea = page.getByRole("textbox", { name: /What would you like to transform/i });
    await promptArea.click();
    await promptArea.fill(
      "Remove duplicate rows and standardize text casing to lowercase"
    );

    await page.waitForTimeout(500);
    const promptContainer = promptArea.locator('..').locator('..');
    const sendButton = promptContainer.locator('button:not([disabled])').last();
    await sendButton.click();

    // The AI might ask for clarification or jump straight to building.
    // We race between both outcomes so the test handles either case.
    const clarifyOrPipeline = await Promise.race([
      page.locator("text=Clarify Request").waitFor({ state: "visible", timeout: 60_000 }).then(() => "clarify"),
      page.locator("text=Data Input").waitFor({ state: "visible", timeout: 60_000 }).then(() => "pipeline"),
      page.locator('button:has-text("Run Pipeline")').waitFor({ state: "visible", timeout: 60_000 }).then(() => "pipeline"),
      page.locator('button:has-text("Cancel Pipeline")').waitFor({ state: "visible", timeout: 60_000 }).then(() => "pipeline"),
    ]);

    if (clarifyOrPipeline === "clarify") {
      const clarifyInput = page.locator("textarea").last();
      await clarifyInput.fill(
        "Remove exact duplicate rows and convert all text columns to lowercase"
      );
      await page.getByRole("button", { name: "Continue" }).click();

      await expect(
        page.locator('button:has-text("Run Pipeline"), button:has-text("Cancel Pipeline")').first()
      ).toBeVisible({ timeout: 90_000 });
    }

    // Wait for the AI to finish building, then run the pipeline
    const runPipelineBtn = page.locator('button:has-text("Run Pipeline")');
    await expect(runPipelineBtn).toBeEnabled({ timeout: 120_000 });
    await runPipelineBtn.click();

    // Button disables during execution, re-enables when done
    await page.waitForTimeout(2_000);
    await expect(runPipelineBtn).toBeEnabled({ timeout: 120_000 });

    try {
      await page.locator('text=Pipeline execution completed').waitFor({ state: "visible", timeout: 5_000 });
    } catch {
      // toast might have already disappeared
    }

    // Click the output node to reveal the Preview tab
    const customNode = page.getByRole("button", { name: /Custom/ }).first();
    await customNode.click({ timeout: 10_000 });
    await page.waitForTimeout(1_000);

    const previewTab = page.locator('[role="tab"]').filter({ hasText: 'Preview' }).first();
    await expect(previewTab).toBeVisible({ timeout: 10_000 });
    await previewTab.click();

    // Make sure we can see actual data rows
    await expect(page.locator('button:has-text("Download")').first()).toBeVisible({
      timeout: 15_000,
    });
    const dataCell = page.locator("td, [role='cell'], [role='gridcell']").first();
    await expect(dataCell).toBeVisible({ timeout: 10_000 });

    // Download opens a dropdown, we pick CSV
    const downloadButton = page.locator('button:has-text("Download")').first();
    await downloadButton.click();

    const csvOption = page.locator('text=Download as CSV');
    await expect(csvOption).toBeVisible({ timeout: 5_000 });

    // Listener needs to be set up before the click to avoid race conditions
    const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
    await csvOption.click();

    const download = await downloadPromise;
    const downloadPath = path.resolve(__dirname, "../../test-data/output_cleaned.csv");
    await download.saveAs(downloadPath);

    // Validate the actual content, not just that a file was downloaded
    const fs = await import("fs");
    expect(fs.existsSync(downloadPath)).toBeTruthy();

    const content = fs.readFileSync(downloadPath, "utf-8");
    const lines = content.trim().split("\n");

    expect(lines.length).toBeGreaterThan(1);

    const header = lines[0].toLowerCase();
    expect(header).toContain("name");
    expect(header).toContain("age");
    expect(header).toContain("email");

    // Confirm text was actually lowercased
    const firstRow = lines[1];
    expect(firstRow).toBe(firstRow.toLowerCase());

    // Confirm duplicates were actually removed (input has 20 rows)
    expect(lines.length - 1).toBeLessThan(20);

    console.log(`Download verified: ${lines.length - 1} data rows in output`);
  });
});
