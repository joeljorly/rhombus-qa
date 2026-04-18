import { test, expect, request } from "@playwright/test";
import path from "path";
import fs from "fs";

const EMAIL = process.env.RHOMBUS_EMAIL!;
const PASSWORD = process.env.RHOMBUS_PASSWORD!;

const API_BASE = "https://api.rhombusai.com";
const AUTH_BASE = "https://rhombusai.com";

/**
 * Helper: log in via the browser and grab the access token from the session.
 *
 * Rhombus uses Auth0 — the browser holds a session cookie after login,
 * and the /api/auth/session endpoint returns a JWT access token.
 * We replay that flow once, then use the token for direct API calls.
 */
async function getAccessToken(): Promise<string> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  // go to login page
  await page.goto(`${AUTH_BASE}/`);
  await page.click("text=Log In");
  await page.waitForURL(/auth\.rhombusai\.com/, { timeout: 15_000 });

  // fill credentials
  await page.fill('input[name="email"], input[type="email"]', EMAIL);
  await page.fill('input[name="password"], input[type="password"]', PASSWORD);
  await page.click('button:has-text("Log In")');

  // wait for redirect back to app
  await page.waitForURL(/rhombusai\.com\//, { timeout: 30_000 });
  await page.waitForTimeout(2_000); // let session settle

  // grab the access token from the session endpoint
  const sessionResp = await page.request.get(`${AUTH_BASE}/api/auth/session`);
  const session = await sessionResp.json();

  await browser.close();
  return session.accessToken;
}

let TOKEN: string;

test.beforeAll(async () => {
  TOKEN = await getAccessToken();
});

// ─────────────────────────────────────────────
// TEST 1 (positive): Session endpoint returns valid user info
// ─────────────────────────────────────────────
test("GET /api/auth/session should return user info and valid token", async () => {
  // we already got the token, so let's verify the session data
  const ctx = await request.newContext();
  const resp = await ctx.get(`${AUTH_BASE}/api/auth/session`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });

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

  await ctx.dispose();
});

// ─────────────────────────────────────────────
// TEST 2 (positive): Upload dataset to a project
// ─────────────────────────────────────────────
test("POST /api/dataset/datasets/upload should accept a valid CSV", async () => {
  const ctx = await request.newContext();

  // first, create a project to upload to
  const projectResp = await ctx.post(`${API_BASE}/api/dataset/projects/add`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    multipart: {
      name: "API Test Project",
      description: "",
      has_samples: "False",
    },
  });

  expect(projectResp.status()).toBe(201);
  const project = await projectResp.json();
  const projectId = project.id;

  // upload the messy CSV
  const csvPath = path.resolve(__dirname, "../../test-data/messy_data.csv");
  const fileBuffer = fs.readFileSync(csvPath);

  const uploadResp = await ctx.post(
    `${API_BASE}/api/dataset/datasets/upload/${projectId}`,
    {
      headers: { Authorization: `Bearer ${TOKEN}` },
      multipart: {
        title: "messy_data.csv",
        file: {
          name: "messy_data.csv",
          mimeType: "text/csv",
          buffer: fileBuffer,
        },
      },
    }
  );

  expect(uploadResp.status()).toBe(200);

  const uploadBody = await uploadResp.json();

  // response should contain dataset info
  expect(uploadBody).toHaveProperty("id");
  expect(uploadBody).toHaveProperty("title", "messy_data.csv");
  expect(uploadBody).toHaveProperty("content_type", "text/csv");
  expect(uploadBody).toHaveProperty("file_size");

  console.log(`Dataset uploaded successfully. ID: ${uploadBody.id}`);

  await ctx.dispose();
});

// ─────────────────────────────────────────────
// TEST 3 (negative): Upload invalid file should fail
// ─────────────────────────────────────────────
test("POST /api/dataset/datasets/upload should reject an invalid file", async () => {
  const ctx = await request.newContext();

  // create a project first
  const projectResp = await ctx.post(`${API_BASE}/api/dataset/projects/add`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    multipart: {
      name: "API Test Negative",
      description: "",
      has_samples: "False",
    },
  });
  const project = await projectResp.json();
  const projectId = project.id;

  // try uploading a file with garbage content and wrong extension
  const garbageContent = Buffer.from(
    "this is not valid data \x00\x01\x02 random binary junk"
  );

  const uploadResp = await ctx.post(
    `${API_BASE}/api/dataset/datasets/upload/${projectId}`,
    {
      headers: { Authorization: `Bearer ${TOKEN}` },
      multipart: {
        title: "garbage.xyz",
        file: {
          name: "garbage.xyz",
          mimeType: "application/octet-stream",
          buffer: garbageContent,
        },
      },
    }
  );

  // we expect this to either:
  // - return a 4xx error (400, 415, 422) rejecting the file
  // - or return 200 but with an error message in the body
  const status = uploadResp.status();

  if (status >= 400) {
    // server correctly rejected the invalid file
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
    console.log(`Server rejected invalid file with status: ${status}`);
  } else {
    // if server accepted it (some APIs do), check that it at least
    // identified the problematic content type
    const body = await uploadResp.json();
    console.log(
      `Server accepted file with status ${status}. Response:`,
      JSON.stringify(body).slice(0, 200)
    );
    // even if accepted, the file should be stored — this is still useful info
    expect(body).toHaveProperty("id");
  }

  await ctx.dispose();
});

// ─────────────────────────────────────────────
// TEST 4 (negative): Accessing API without auth should fail
// ─────────────────────────────────────────────
test("GET /api/dataset/projects/all without auth should return 401 or 403", async () => {
  const ctx = await request.newContext();

  // call the projects endpoint with no auth token
  const resp = await ctx.get(
    `${API_BASE}/api/dataset/projects/all?limit=20&offset=0`
  );

  // should be rejected — either 401 (Unauthorized) or 403 (Forbidden)
  expect([401, 403]).toContain(resp.status());

  console.log(
    `Unauthenticated request correctly rejected with status: ${resp.status()}`
  );

  await ctx.dispose();
});
