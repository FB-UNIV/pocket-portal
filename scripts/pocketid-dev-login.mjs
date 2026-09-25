#!/usr/bin/env node
// Prints a one-click login link for testing the portal's OIDC flow by hand
// against the test PocketID (docker-compose.test.yml).
//
// PocketID's setup wizard is gone once STATIC_API_KEY has bootstrapped an
// admin, and that admin can't sign in through a browser, so this creates a
// real user (idempotently) and mints a one-time access token for it.
//
// The TTL is deliberately over 15 minutes. PocketID issues a 6-character code
// for ttl <= 15m and a 12-character one above (onetimeaccess/service.go), and
// its login screen demands 12 characters whenever SMTP isn't configured, so a
// short code can never be accepted, not even via /lc/{code}. That's an
// upstream frontend bug; the long code sidesteps it.
import { readFileSync } from "node:fs";

const DEV_USERNAME = process.argv[2] ?? "francois";
const TOKEN_TTL = "30m"; // > 15m => PocketID mints a 12-char code, not 6

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
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "X-API-KEY": apiKey, "Content-Type": "application/json", ...init.headers },
  });
}

async function main() {
  const env = loadEnvTest();
  const baseUrl = env.POCKETID_BASE_URL;
  const apiKey = env.POCKETID_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error("POCKETID_BASE_URL / POCKETID_API_KEY missing from .env.test");
  }

  const usersRes = await pocketIdFetch(baseUrl, apiKey, "/api/users");
  if (!usersRes.ok) {
    throw new Error(`Failed to list users: ${usersRes.status} ${await usersRes.text()}`);
  }
  const { data: users } = await usersRes.json();
  let user = users.find((u) => u.username === DEV_USERNAME);

  if (!user) {
    const createRes = await pocketIdFetch(baseUrl, apiKey, "/api/users", {
      method: "POST",
      body: JSON.stringify({
        username: DEV_USERNAME,
        email: `${DEV_USERNAME}@example.test`,
        firstName: DEV_USERNAME,
        lastName: "(dev)",
        isAdmin: true,
      }),
    });
    if (!createRes.ok) {
      throw new Error(`Failed to create dev user: ${createRes.status} ${await createRes.text()}`);
    }
    user = await createRes.json();
    console.log(`Created dev user "${DEV_USERNAME}" (${user.id}, admin)`);
  } else if (!user.isAdmin) {
    // Self-heal a dev user created before this script granted admin.
    const promoteRes = await pocketIdFetch(baseUrl, apiKey, `/api/users/${user.id}`, {
      method: "PUT",
      body: JSON.stringify({
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        isAdmin: true,
      }),
    });
    if (!promoteRes.ok) {
      throw new Error(`Failed to promote dev user to admin: ${promoteRes.status} ${await promoteRes.text()}`);
    }
    user = await promoteRes.json();
    console.log(`Promoted existing dev user "${DEV_USERNAME}" to admin`);
  }

  const tokenRes = await pocketIdFetch(
    baseUrl,
    apiKey,
    `/api/users/${user.id}/one-time-access-token`,
    { method: "POST", body: JSON.stringify({ ttl: TOKEN_TTL }) },
  );
  if (!tokenRes.ok) {
    throw new Error(`Failed to mint login token: ${tokenRes.status} ${await tokenRes.text()}`);
  }
  const { token } = await tokenRes.json();

  console.log(`\nOne-click PocketID login (valid ${TOKEN_TTL}, single use):`);
  console.log(`  ${baseUrl}/lc/${token}\n`);
  console.log(
    `Open that link, then register a passkey under Settings -> Passkeys — that's what\nyou'll use to sign in through the portal itself afterward.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
