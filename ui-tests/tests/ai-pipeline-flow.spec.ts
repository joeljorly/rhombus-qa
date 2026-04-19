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
    // ── Step 1: Sign in ──
    // go directly to the app -- it will show the dashboard (logged out)
    await page.goto("https://rhombusai.com");

    // dismiss the "Start Building" tutorial dialog
    const dialog = page.locator('[role="dialog"]');
    await dialog.waitFor({ state: "visible", timeout: 10_000 });
    await dialog.locator('button:has-text("Close")').click();
    await dialog.waitFor({ state: "hidden", timeout: 5_000 });

    // click the Log In button in the sidebar
    await page.getByRole("button", { name: "Log In" }).click();

    // wait for the Auth0 login page to load
    await page.waitForURL(/auth\.rhombusai\.com/, { timeout: 30_000 });

    // ── Step 2: Fill credentials and submit ──
    await page.getByRole("textbox", { name: "Email address" }).fill(EMAIL);
    await page.getByRole("textbox", { name: "Password" }).fill(PASSWORD);
    await page.getByRole("button", { name: "Log In" }).click();

    // wait for redirect -- could go to /hub or /
    await page.waitForURL(/rhombusai\.com/, { timeout: 30_000 });
    // give the app a moment to settle after auth redirect
    await page.waitForTimeout(2_000);

    // if we landed on /hub, navigate to the app
    if (page.url().includes("/hub")) {
      await page.goto("https://rhombusai.com", {
        waitUntil: "domcontentloaded",
      });
      await page.waitForTimeout(3_000);
    }

    // if still on hub, try /workflow
    if (page.url().includes("/hub")) {
      await page.goto("https://rhombusai.com/workflow", {
        waitUntil: "domcontentloaded",
      });
      await page.waitForTimeout(3_000);
    }

    // dismiss any tutorial dialog that appears after login
    try {
      const postLoginDialog = page.locator('[role="dialog"]');
      await postLoginDialog.waitFor({ state: "visible", timeout: 5_000 });
      await postLoginDialog.locator('button:has-text("Close")').click();
      await postLoginDialog.waitFor({ state: "hidden", timeout: 5_000 });
    } catch {
      // no dialog -- continue
    }

    // verify we see the app dashboard
    await expect(
      page.locator('text=New Project').first()
    ).toBeVisible({ timeout: 15_000 });

    // ── Step 3: Upload messy CSV and send prompt ──
    // click the "+" button (ref=e106) to open the "Add New File" dialog
    // the button is inside a container with the textbox, target it directly
    const textbox = page.getByRole("textbox", { name: /Attach or drop a file/i });
    // the "+" button is a sibling of the textbox, inside the same parent container
    const promptParent = textbox.locator('..').locator('..');
    await promptParent.locator('button').first().click();

    // wait for the "Add New File" dialog to appear
    const addFileDialog = page.getByRole("dialog", { name: "Add New File" });
    await expect(addFileDialog).toBeVisible({ timeout: 10_000 });

    // the dialog has a hidden file input -- find it and set files directly
    const hiddenInput = addFileDialog.locator('input[type="file"]');
    const hasHiddenInput = await hiddenInput.count();

    if (hasHiddenInput > 0) {
      // directly set files on the hidden input
      await hiddenInput.setInputFiles(TEST_CSV);
    } else {
      // fall back to clicking "Browse Here" to trigger file chooser
      const [fileChooser] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: 15_000 }),
        addFileDialog.locator('text=Browse Here').click(),
      ]);
      await fileChooser.setFiles(TEST_CSV);
    }

    // wait for file to appear in the dialog
    await page.waitForTimeout(2_000);
    // wait for Attach button to become enabled (it's disabled until file is selected)
    const attachBtn = addFileDialog.getByRole("button", { name: "Attach" });
    await expect(attachBtn).toBeEnabled({ timeout: 10_000 });
    await attachBtn.click();

    // wait for dialog to close
    await expect(addFileDialog).toBeHidden({ timeout: 10_000 });

    // type the transformation prompt in the correct text area
    // after file attach, the placeholder changes to "What would you like to transform?"
    const promptArea = page.getByRole("textbox", { name: /What would you like to transform/i });
    await promptArea.click();
    await promptArea.fill(
      "Remove duplicate rows and standardize text casing to lowercase"
    );

    // click the send button (the enabled button with an arrow icon next to the prompt)
    // wait briefly for send button to become enabled after typing
    await page.waitForTimeout(500);
    const promptContainer = promptArea.locator('..').locator('..');
    const sendButton = promptContainer.locator('button:not([disabled])').last();
    await sendButton.click();

    // ── Step 4: Handle clarification popup if it appears ──
    // the AI may ask for clarification or proceed directly to building the pipeline
    // wait for either the clarification dialog OR the pipeline canvas to appear
    const clarifyOrPipeline = await Promise.race([
      page.locator("text=Clarify Request").waitFor({ state: "visible", timeout: 60_000 }).then(() => "clarify"),
      page.locator("text=Data Input").waitFor({ state: "visible", timeout: 60_000 }).then(() => "pipeline"),
      page.locator('button:has-text("Run Pipeline")').waitFor({ state: "visible", timeout: 60_000 }).then(() => "pipeline"),
      page.locator('button:has-text("Cancel Pipeline")').waitFor({ state: "visible", timeout: 60_000 }).then(() => "pipeline"),
    ]);

    if (clarifyOrPipeline === "clarify") {
      // fill in the clarification
      const clarifyInput = page.locator("textarea").last();
      await clarifyInput.fill(
        "Remove exact duplicate rows and convert all text columns to lowercase"
      );
      await page.getByRole("button", { name: "Continue" }).click();
      
      // now wait for pipeline to appear after clarification
      await expect(
        page.locator('button:has-text("Run Pipeline"), button:has-text("Cancel Pipeline")').first()
      ).toBeVisible({ timeout: 90_000 });
    }

    // ── Step 5: Wait for pipeline to be built and executed ──
    const runPipelineBtn = page.locator('button:has-text("Run Pipeline")');

    // wait for Run Pipeline to be enabled (AI finished building)
    await expect(runPipelineBtn).toBeEnabled({ timeout: 120_000 });

    // click Run Pipeline to execute it
    await runPipelineBtn.click();

    // wait for pipeline execution to complete
    // the button becomes disabled during execution, then re-enabled when done
    // first wait for it to become disabled (execution started)
    await page.waitForTimeout(2_000);
    // then wait for it to become enabled again (execution finished)
    await expect(runPipelineBtn).toBeEnabled({ timeout: 120_000 });

    // also check for the success toast notification
    try {
      await page.locator('text=Pipeline execution completed').waitFor({ state: "visible", timeout: 5_000 });
    } catch {
      // toast might have already disappeared
    }

    // ── Step 6: Preview the output ──
    // click on the Custom output node to select it — this reveals the Preview tab
    // the node's full accessible name includes "Custom [OP_ROLE=transform]..."
    const customNode = page.getByRole("button", { name: /Custom/ }).first();
    await customNode.click({ timeout: 10_000 });
    await page.waitForTimeout(1_000);

    // after clicking the node, the top tablist should now show Canvas + Preview
    const previewTab = page.locator('[role="tab"]').filter({ hasText: 'Preview' }).first();
    await expect(previewTab).toBeVisible({ timeout: 10_000 });
    await previewTab.click();

    // verify preview table is visible with data
    // look for the Download button which confirms we're on the Preview page
    await expect(page.locator('button:has-text("Download")').first()).toBeVisible({
      timeout: 15_000,
    });

    // verify data rows are present
    const dataCell = page.locator("td, [role='cell'], [role='gridcell']").first();
    await expect(dataCell).toBeVisible({ timeout: 10_000 });

    // ── Step 7: Download the results ──
    const downloadButton = page.locator('button:has-text("Download")').first();
    await expect(downloadButton).toBeVisible({ timeout: 10_000 });

    // click Download to open the dropdown menu
    await downloadButton.click();

    // wait for dropdown to appear and click "Download as CSV"
    const csvOption = page.locator('text=Download as CSV');
    await expect(csvOption).toBeVisible({ timeout: 5_000 });

    // set up download listener BEFORE clicking the CSV option
    const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
    await csvOption.click();

    const download = await downloadPromise;

    // save the downloaded file
    const downloadPath = path.resolve(
      __dirname,
      "../../test-data/output_cleaned.csv"
    );
    await download.saveAs(downloadPath);

    // ── Assertions on downloaded data ──
    const fs = await import("fs");
    expect(fs.existsSync(downloadPath)).toBeTruthy();

    const content = fs.readFileSync(downloadPath, "utf-8");
    const lines = content.trim().split("\n");

    // should have header + data rows
    expect(lines.length).toBeGreaterThan(1);

    // header should contain expected columns
    const header = lines[0].toLowerCase();
    expect(header).toContain("name");
    expect(header).toContain("age");
    expect(header).toContain("email");

    // first data row should be lowercase
    const firstRow = lines[1];
    expect(firstRow).toBe(firstRow.toLowerCase());

    // should have fewer rows than input (20 rows) due to dedup
    expect(lines.length - 1).toBeLessThan(20);

    console.log(`Download verified: ${lines.length - 1} data rows in output`);
  });
});
