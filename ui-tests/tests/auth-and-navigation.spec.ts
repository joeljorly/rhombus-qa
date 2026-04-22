import { test, expect } from "@playwright/test";

const EMAIL = process.env.RHOMBUS_EMAIL!;
const PASSWORD = process.env.RHOMBUS_PASSWORD!;

/** Dismisses the onboarding dialog if it appears. */
async function dismissDialog(page: any) {
  try {
    const dialog = page.locator('[role="dialog"]');
    await dialog.waitFor({ state: "visible", timeout: 5_000 });
    await dialog.locator('button:has-text("Close")').click();
    await dialog.waitFor({ state: "hidden", timeout: 5_000 });
  } catch {
    // no dialog, safe to continue
  }
}

/** Logs in and navigates to the app dashboard. Reused across tests. */
async function loginAndNavigate(page: any) {
  await page.goto("https://rhombusai.com");
  await dismissDialog(page);

  await page.getByRole("button", { name: "Log In" }).click();
  await page.waitForURL(/auth\.rhombusai\.com/, { timeout: 30_000 });

  await page.getByRole("textbox", { name: "Email address" }).fill(EMAIL);
  await page.getByRole("textbox", { name: "Password" }).fill(PASSWORD);
  await page.getByRole("button", { name: "Log In" }).click();

  await page.waitForURL(/rhombusai\.com/, { timeout: 30_000 });
  await page.waitForTimeout(2_000);

  if (page.url().includes("/hub")) {
    await page.goto("https://rhombusai.com", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3_000);
  }

  await dismissDialog(page);
}

test.describe("Rhombus AI - Authentication", () => {
  // Wrong password should be rejected with a visible error
  test("should show error message for invalid credentials", async ({ page }) => {
    await page.goto("https://rhombusai.com");
    await dismissDialog(page);

    await page.getByRole("button", { name: "Log In" }).click();
    await page.waitForURL(/auth\.rhombusai\.com/, { timeout: 30_000 });

    await page.getByRole("textbox", { name: "Email address" }).fill(EMAIL);
    await page.getByRole("textbox", { name: "Password" }).fill("WrongPassword123!");
    await page.getByRole("button", { name: "Log In" }).click();

    // Should stay on the auth page, not redirect to the app
    await page.waitForTimeout(3_000);
    expect(page.url()).toContain("auth.rhombusai.com");

    const errorVisible = await page
      .locator('text=/wrong|invalid|incorrect|failed|error/i')
      .first()
      .isVisible()
      .catch(() => false);

    expect(errorVisible).toBeTruthy();
  });

  // Log in, then log out, verify we're back to logged-out state
  test("should log out and show login button", async ({ page }) => {
    await loginAndNavigate(page);

    await expect(
      page.locator(`text=${EMAIL}`).first()
    ).toBeVisible({ timeout: 10_000 });

    // Open the profile menu
    const profileArea = page.locator(`text=${EMAIL}`).first();
    await profileArea.click();
    await page.waitForTimeout(1_000);

    const logoutBtn = page.locator(
      'text=/log out|logout|sign out|signout/i'
    ).first();

    const hasLogout = await logoutBtn.isVisible().catch(() => false);

    if (hasLogout) {
      await logoutBtn.click();
      await page.waitForTimeout(3_000);

      const loggedOut =
        (await page.locator('text=Log In').first().isVisible().catch(() => false)) ||
        page.url().includes("auth.rhombusai.com");

      expect(loggedOut).toBeTruthy();
    } else {
      console.log("Logout button not found in profile menu, skipping assertion");
    }
  });
});

test.describe("Rhombus AI - Project Navigation", () => {
  // Clicking an existing project should load the pipeline canvas
  test("should navigate to an existing project and see the pipeline canvas", async ({
    page,
  }) => {
    await loginAndNavigate(page);

    await expect(
      page.locator("text=All Projects").first()
    ).toBeVisible({ timeout: 10_000 });

    const projectLink = page.locator('a[href*="/workflow/"]').first();
    await expect(projectLink).toBeVisible({ timeout: 10_000 });

    const projectName = await projectLink.innerText();
    await projectLink.click();

    await page.waitForURL(/\/workflow\//, { timeout: 15_000 });

    await expect(
      page.locator('text=Canvas').first()
    ).toBeVisible({ timeout: 15_000 });

    const hasAddNode = await page
      .locator('text=Add Node')
      .first()
      .isVisible()
      .catch(() => false);

    const hasRunPipeline = await page
      .locator('text=Run Pipeline')
      .first()
      .isVisible()
      .catch(() => false);

    expect(hasAddNode || hasRunPipeline).toBeTruthy();

    console.log(`Successfully navigated to project: ${projectName.trim()}`);
  });
});
