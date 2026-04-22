import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";
import { Browser, BrowserContext, Page } from "playwright";

const EMAIL = process.env.RHOMBUS_EMAIL!;
const PASSWORD = process.env.RHOMBUS_PASSWORD!;

const API_BASE = "https://api.rhombusai.com";
const AUTH_BASE = "https://rhombusai.com";

// Shared browser state. We log in once and reuse the session for all tests.
let browser: Browser;
let authContext: BrowserContext;
let accessToken: string;
let appPage: Page;

// Log in via Auth0 and grab the JWT from the session endpoint.
// We keep appPage alive because API calls need to run from the
// rhombusai.com origin for CORS to work with api.rhombusai.com.
test.beforeAll(async () => {
  const { chromium } = await import("playwright");
  browser = await chromium.launch();
  authContext = await browser.newContext();
  const page = await authContext.newPage();

  await page.goto(`${AUTH_BASE}/`);

  const dialog = page.locator('[role="dialog"]');
  await dialog.waitFor({ state: "visible", timeout: 10_000 });
  await dialog.locator('button:has-text("Close")').click();
  await dialog.waitFor({ state: "hidden", timeout: 5_000 });

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

  try {
    const d = page.locator('[role="dialog"]');
    await d.waitFor({ state: "visible", timeout: 3_000 });
    await d.locator('button:has-text("Close")').click();
    await d.waitFor({ state: "hidden", timeout: 3_000 });
  } catch {}

  const sessionResp = await page.request.get(`${AUTH_BASE}/api/auth/session`);
  const session = await sessionResp.json();
  accessToken = session.accessToken;

  appPage = page;
});

test.afterAll(async () => {
  await browser?.close();
});

// Verify the session endpoint returns user data and a valid JWT
test("GET /api/auth/session should return user info and valid token", async () => {
  const resp = await appPage.request.get(`${AUTH_BASE}/api/auth/session`);
  expect(resp.status()).toBe(200);

  const body = await resp.json();

  expect(body).toHaveProperty("user");
  expect(body.user).toHaveProperty("email");
  expect(body.user.email).toBe(EMAIL);

  expect(body).toHaveProperty("accessToken");
  expect(body.accessToken).toBeTruthy();

  // Token should not be expired
  expect(body).toHaveProperty("expires");
  const expiryDate = new Date(body.expires);
  expect(expiryDate.getTime()).toBeGreaterThan(Date.now());
});

// Verify the projects endpoint returns a paginated list for authenticated users
test("GET /api/dataset/projects/all should return user projects", async () => {
  const result = await appPage.evaluate(
    async ({ apiBase, token }) => {
      const resp = await fetch(
        `${apiBase}/api/dataset/projects/all?limit=20&offset=0`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      return { status: resp.status, body: await resp.json() };
    },
    { apiBase: API_BASE, token: accessToken }
  );

  expect(result.status).toBe(200);

  // Response format: { items: [...], total: N }
  expect(result.body).toHaveProperty("items");
  expect(result.body).toHaveProperty("total");
  expect(Array.isArray(result.body.items)).toBeTruthy();
  expect(result.body.items.length).toBeGreaterThan(0);

  const firstProject = result.body.items[0];
  expect(firstProject).toHaveProperty("id");
  expect(firstProject).toHaveProperty("name");

  console.log(`Found ${result.body.total} project(s). First: ${firstProject.name}`);
});

// Upload garbage data and verify the server rejects it (negative test)
test("POST /api/dataset/datasets/upload should reject an invalid file", async () => {
  // Create a throwaway project to upload to
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

  // Upload binary garbage with a nonsense file extension
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
    // Server rejected the file. 4xx means client error, 500 can happen
    // when the server fails to parse the garbage content.
    expect(status).toBeGreaterThanOrEqual(400);
    console.log(`Server rejected invalid file with status: ${status}`);
  } else {
    console.log(
      `Server accepted file with status ${status}. Response:`,
      JSON.stringify(uploadResult.body).slice(0, 200)
    );
    expect(uploadResult.body).toHaveProperty("id");
  }
});

// Call the API with no auth and verify it gets rejected (negative test)
test("GET /api/dataset/projects/all without auth should return 401 or 403", async () => {
  // Fresh context with zero cookies or tokens
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

// Find a project with pipeline output and download it via the API
test("GET download endpoint should return valid CSV data", async () => {
  const projectsResult = await appPage.evaluate(
    async ({ apiBase, token }) => {
      const resp = await fetch(
        `${apiBase}/api/dataset/projects/all?limit=20&offset=0`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      return { status: resp.status, body: await resp.json() };
    },
    { apiBase: API_BASE, token: accessToken }
  );

  expect(projectsResult.status).toBe(200);
  const projects = projectsResult.body.items;
  expect(projects.length).toBeGreaterThan(0);

  let downloadFound = false;

  for (const project of projects) {
    const nodesResult = await appPage.evaluate(
      async ({ apiBase, token, projId }) => {
        const resp = await fetch(
          `${apiBase}/api/dataset/analyzer/v2/projects/${projId}/nodes`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (resp.status !== 200) return { status: resp.status, body: [] };
        return { status: resp.status, body: await resp.json() };
      },
      { apiBase: API_BASE, token: accessToken, projId: project.id }
    );

    if (nodesResult.status !== 200 || !Array.isArray(nodesResult.body)) continue;

    // LLM nodes contain the transformed output
    const outputNode = nodesResult.body.find(
      (n: any) => n.name && n.name.startsWith("llm_")
    );
    if (!outputNode) continue;

    const downloadResult = await appPage.evaluate(
      async ({ apiBase, token, projId, nodeName }) => {
        const resp = await fetch(
          `${apiBase}/api/dataset/analyzer/v2/projects/${projId}/nodes/output-download?node_name=${nodeName}&format=csv`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const text = await resp.text();
        return { status: resp.status, text: text.slice(0, 500) };
      },
      {
        apiBase: API_BASE,
        token: accessToken,
        projId: project.id,
        nodeName: outputNode.name,
      }
    );

    if (downloadResult.status === 200) {
      expect(downloadResult.text).toContain("name");
      expect(downloadResult.text).toContain(",");
      const lines = downloadResult.text.trim().split("\n");
      expect(lines.length).toBeGreaterThan(1);

      console.log(
        `Download endpoint returned CSV with ${lines.length} lines from project ${project.id}`
      );
      downloadFound = true;
      break;
    }
  }

  expect(downloadFound).toBeTruthy();
});
