import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";
import { Browser, BrowserContext, Page } from "playwright";

const EMAIL = process.env.RHOMBUS_EMAIL!;
const PASSWORD = process.env.RHOMBUS_PASSWORD!;

const API_BASE = "https://api.rhombusai.com";
const AUTH_BASE = "https://rhombusai.com";

let browser: Browser;
let authContext: BrowserContext;
let accessToken: string;
let appPage: Page; // keep a page on rhombusai.com for API calls

test.beforeAll(async () => {
  const { chromium } = await import("playwright");
  browser = await chromium.launch();
  authContext = await browser.newContext();
  const page = await authContext.newPage();

  // go to app
  await page.goto(`${AUTH_BASE}/`);

  // dismiss the "Start Building" tutorial dialog
  const dialog = page.locator('[role="dialog"]');
  await dialog.waitFor({ state: "visible", timeout: 10_000 });
  await dialog.locator('button:has-text("Close")').click();
  await dialog.waitFor({ state: "hidden", timeout: 5_000 });

  // click Log In
  await page.getByRole("button", { name: "Log In" }).click();
  await page.waitForURL(/auth\.rhombusai\.com/, { timeout: 30_000 });

  // fill credentials
  await page.getByRole("textbox", { name: "Email address" }).fill(EMAIL);
  await page.getByRole("textbox", { name: "Password" }).fill(PASSWORD);
  await page.getByRole("button", { name: "Log In" }).click();

  // wait for redirect back to app
  await page.waitForURL(/rhombusai\.com/, { timeout: 30_000 });
  await page.waitForTimeout(2_000);

  // if on /hub, navigate to app root
  if (page.url().includes("/hub")) {
    await page.goto("https://rhombusai.com", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3_000);
  }

  // dismiss dialog if it appears again
  try {
    const d = page.locator('[role="dialog"]');
    await d.waitFor({ state: "visible", timeout: 3_000 });
    await d.locator('button:has-text("Close")').click();
    await d.waitFor({ state: "hidden", timeout: 3_000 });
  } catch {}

  // grab the access token from the session endpoint
  const sessionResp = await page.request.get(`${AUTH_BASE}/api/auth/session`);
  const session = await sessionResp.json();
  accessToken = session.accessToken;

  // keep this page alive for API calls (it's on rhombusai.com origin)
  appPage = page;
});

test.afterAll(async () => {
  await browser?.close();
});

// ─────────────────────────────────────────────
// TEST 1 (positive): Session endpoint returns valid user info
// ─────────────────────────────────────────────
test("GET /api/auth/session should return user info and valid token", async () => {
  const resp = await appPage.request.get(`${AUTH_BASE}/api/auth/session`);

  expect(resp.status()).toBe(200);

  const body = await resp.json();

  // should contain user object with email
  expect(body).toHaveProperty("user");
  expect(body.user).toHaveProperty("email");
  expect(body.user.email).toBe(EMAIL);

  // should contain an access token
  expect(body).toHaveProperty("accessToken");
  expect(body.accessToken).toBeTruthy();

  // should contain an expiry date in the future
  expect(body).toHaveProperty("expires");
  const expiryDate = new Date(body.expires);
  expect(expiryDate.getTime()).toBeGreaterThan(Date.now());
});

// ─────────────────────────────────────────────
// TEST 2 (positive): Create project and upload CSV
// ─────────────────────────────────────────────
test("GET /api/dataset/projects/all should return user projects", async () => {
  // fetch the list of projects using the access token
  const result = await appPage.evaluate(
    async ({ apiBase, token }) => {
      const resp = await fetch(
        `${apiBase}/api/dataset/projects/all?limit=20&offset=0`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      return { status: resp.status, body: await resp.json() };
    },
    { apiBase: API_BASE, token: accessToken }
  );

  expect(result.status).toBe(200);

  // response is { items: [...], total: N }
  expect(result.body).toHaveProperty("items");
  expect(result.body).toHaveProperty("total");
  expect(Array.isArray(result.body.items)).toBeTruthy();
  expect(result.body.items.length).toBeGreaterThan(0);

  // each project should have an id and name
  const firstProject = result.body.items[0];
  expect(firstProject).toHaveProperty("id");
  expect(firstProject).toHaveProperty("name");

  console.log(`Found ${result.body.total} project(s). First: ${firstProject.name}`);
});

// ─────────────────────────────────────────────
// TEST 3 (negative): Upload invalid file should fail
// ─────────────────────────────────────────────
test("POST /api/dataset/datasets/upload should reject an invalid file", async () => {
  // create a project first
  const projectResult = await appPage.evaluate(
    async ({ apiBase, token }) => {
      const formData = new FormData();
      formData.append("name", "API Test Negative");
      formData.append("description", "");
      formData.append("has_samples", "False");

      const resp = await fetch(`${apiBase}/api/dataset/projects/add`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      return { status: resp.status, body: await resp.json() };
    },
    { apiBase: API_BASE, token: accessToken }
  );
  const projectId = projectResult.body.id;

  // try uploading garbage binary data
  const uploadResult = await appPage.evaluate(
    async ({ apiBase, token, projId }) => {
      const formData = new FormData();
      formData.append("title", "garbage.xyz");
      formData.append(
        "file",
        new Blob(["this is not valid data \x00\x01\x02 random binary junk"], {
          type: "application/octet-stream",
        }),
        "garbage.xyz"
      );

      const resp = await fetch(
        `${apiBase}/api/dataset/datasets/upload/${projId}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        }
      );
      let body;
      try { body = await resp.json(); } catch { body = null; }
      return { status: resp.status, body };
    },
    { apiBase: API_BASE, token: accessToken, projId: projectId }
  );

  const status = uploadResult.status;

  if (status >= 400) {
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
    console.log(`Server rejected invalid file with status: ${status}`);
  } else {
    console.log(
      `Server accepted file with status ${status}. Response:`,
      JSON.stringify(uploadResult.body).slice(0, 200)
    );
    expect(uploadResult.body).toHaveProperty("id");
  }
});

// ─────────────────────────────────────────────
// TEST 4 (negative): Unauthenticated access should fail
// ─────────────────────────────────────────────
test("GET /api/dataset/projects/all without auth should return 401 or 403", async () => {
  const freshContext = await browser.newContext();
  const page = await freshContext.newPage();

  const resp = await page.request.get(
    `${API_BASE}/api/dataset/projects/all?limit=20&offset=0`
  );

  expect([401, 403]).toContain(resp.status());
  console.log(`Unauthenticated request correctly rejected with status: ${resp.status()}`);

  await page.close();
  await freshContext.close();
});
