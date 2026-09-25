import { type Page, type APIRequestContext, expect } from "@playwright/test";

// Signs a seeded user (scripts/pocketid-seed-catalog.mjs) into the portal.
//
// PocketID's interactive login is passkey-only, which headless e2e can't
// drive. A one-time access token, the mechanism `npm run dev-login`
// uses, opens a PocketID session instead, and the portal's real
// authorization-code login runs from there. The portal never sees passkeys,
// so nothing it does is skipped.
//
// PocketID rate-limits redeeming those tokens (burst 5, then 1 per 10s, per
// IP), so specs sign in once in e2e/auth.setup.ts and reuse the session via
// sessionFile() rather than calling signInAsSeedUser per test.

const POCKETID_BASE_URL = process.env.POCKETID_BASE_URL;
const POCKETID_API_KEY = process.env.POCKETID_API_KEY;

function requireEnv(): { baseUrl: string; apiKey: string } {
  if (!POCKETID_BASE_URL || !POCKETID_API_KEY) {
    throw new Error("POCKETID_BASE_URL / POCKETID_API_KEY must be set (load .env.test + .env.test.generated)");
  }
  return { baseUrl: POCKETID_BASE_URL, apiKey: POCKETID_API_KEY };
}

async function mintOneTimeToken(request: APIRequestContext, username: string): Promise<string> {
  const { baseUrl, apiKey } = requireEnv();
  const headers = { "X-API-KEY": apiKey };

  // Search rather than list everyone, and still follow every page:
  // `search` is a substring match over names and emails too, so several
  // users can match; the exact username check below picks the right one.
  const users: Array<{ id: string; username: string }> = [];
  for (let page = 1, totalPages = 1; page <= totalPages; page++) {
    const query = new URLSearchParams({
      search: username,
      "pagination[page]": String(page),
      "pagination[limit]": "100",
    });
    const usersRes = await request.get(`${baseUrl}/api/users?${query}`, { headers });
    if (!usersRes.ok()) throw new Error(`list users failed: ${usersRes.status()}`);
    const body = await usersRes.json();
    users.push(...body.data);
    totalPages = body.pagination.totalPages;
  }
  const user = users.find((u) => u.username === username);
  if (!user) {
    throw new Error(`Seed user "${username}" not found — did \`npm run test-env:up\` (which runs pocketid-seed-catalog.mjs) run?`);
  }

  const tokenRes = await request.post(`${baseUrl}/api/users/${user.id}/one-time-access-token`, {
    headers: { ...headers, "Content-Type": "application/json" },
    data: { ttl: "30m" },
  });
  if (!tokenRes.ok()) throw new Error(`mint one-time token failed: ${tokenRes.status()}`);
  return (await tokenRes.json()).token as string;
}

// Signs the given seeded user in and leaves the browser on the portal home page
// with an authenticated session. Asserts the session actually came back.
export async function signInAsSeedUser(page: Page, username = "e2e-user"): Promise<void> {
  const { baseUrl } = requireEnv();

  // Establish a PocketID session in this browser context by redeeming a
  // one-time token. page.request shares its cookie jar with the context, so the
  // resulting PocketID `access_token` cookie is present for the OIDC round-trip.
  const token = await mintOneTimeToken(page.request, username);
  const redeem = await page.request.post(`${baseUrl}/api/one-time-access-token/${token}`);
  expect(redeem.ok(), "redeeming the one-time access token should establish a PocketID session").toBeTruthy();

  // Drive the portal's real sign-in: home -> PocketID /authorize (SSO via the
  // session above) -> /api/auth/callback -> back to the portal, signed in.
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in with PocketID" }).click();
  await page.waitForURL("http://localhost:3000/**");
  await expect(page.getByText(/Signed in as/)).toBeVisible();
}

// Where e2e/auth.setup.ts saves each seed user's signed-in session. Specs
// reuse it with `test.use({ storageState: sessionFile("e2e-user") })` rather
// than signing in again, which PocketID's rate limit wouldn't allow for
// every test.
export function sessionFile(username: string): string {
  return `e2e/.auth/${username}.json`;
}
