#!/usr/bin/env node
// Registers the portal's OIDC client in the test PocketID
// (docker-compose.test.yml), idempotently, and writes a freshly minted
// secret to the gitignored .env.test.generated: PocketID returns a client
// secret only once, at creation.
//
// POST /api/oidc/clients and POST /api/oidc/clients/{id}/secrets, verified
// against a live instance (PocketID's public API page doesn't list them).
import { readFileSync, writeFileSync } from "node:fs";

const TEST_CLIENT_ID = "00000000-0000-4000-8000-000000000001";
const CALLBACK_URL = "http://localhost:3000/api/auth/callback/pocketid";

function loadEnvTest() {
  const env = {};
  for (const line of readFileSync(".env.test", "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return env;
}

async function pocketIdFetch(baseUrl, apiKey, path, init = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "X-API-KEY": apiKey, "Content-Type": "application/json", ...init.headers },
  });
  return res;
}

async function main() {
  const env = loadEnvTest();
  const baseUrl = env.POCKETID_BASE_URL;
  const apiKey = env.POCKETID_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error("POCKETID_BASE_URL / POCKETID_API_KEY missing from .env.test");
  }

  const existing = await pocketIdFetch(baseUrl, apiKey, `/api/oidc/clients/${TEST_CLIENT_ID}`);
  if (existing.status === 404) {
    const created = await pocketIdFetch(baseUrl, apiKey, "/api/oidc/clients", {
      method: "POST",
      body: JSON.stringify({
        id: TEST_CLIENT_ID,
        name: "pocket-portal (test)",
        callbackURLs: [CALLBACK_URL],
        logoutCallbackURLs: ["http://localhost:3000"],
        pkceEnabled: true,
        // Skip PocketID's consent screen for this first-party test client so
        // e2e can complete the real authorization-code login deterministically:
        // with an authenticated PocketID session, /authorize issues the code
        // straight to our callback instead of pausing on an interstitial a test
        // would otherwise have to click through (see e2e/helpers/auth.ts).
        skipConsent: true,
      }),
    });
    if (!created.ok) {
      throw new Error(`Failed to create test OIDC client: ${created.status} ${await created.text()}`);
    }
  } else if (!existing.ok) {
    throw new Error(`Failed to look up test OIDC client: ${existing.status} ${await existing.text()}`);
  }

  const secretRes = await pocketIdFetch(
    baseUrl,
    apiKey,
    `/api/oidc/clients/${TEST_CLIENT_ID}/secrets`,
    { method: "POST" },
  );
  if (!secretRes.ok) {
    throw new Error(`Failed to mint test OIDC client secret: ${secretRes.status} ${await secretRes.text()}`);
  }
  const { secret } = await secretRes.json();

  writeFileSync(
    ".env.test.generated",
    `POCKETID_OIDC_CLIENT_ID=${TEST_CLIENT_ID}\nPOCKETID_OIDC_CLIENT_SECRET=${secret}\n`,
  );
  console.log("Provisioned test OIDC client -> .env.test.generated");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
