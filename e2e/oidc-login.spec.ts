import { test, expect } from "@playwright/test";

// Full interactive login can't be automated here: PocketID is passkey/WebAuthn-only
// (no password fallback), which would need a CDP virtual authenticator to drive end
// to end. This test instead proves the authorization request our app builds is
// correct against the real test PocketID instance (docker-compose.test.yml) — right
// endpoint, right client, right redirect URI, PKCE challenge present.
test("signing in redirects to PocketID's real authorization endpoint with a valid request", async ({
  request,
}) => {
  const csrfRes = await request.get("/api/auth/csrf");
  const { csrfToken } = await csrfRes.json();

  const signInRes = await request.post("/api/auth/signin/pocketid", {
    form: { csrfToken },
    maxRedirects: 0,
  });

  expect(signInRes.status()).toBe(302);

  const location = new URL(signInRes.headers()["location"]);
  const pocketIdBaseUrl = new URL(process.env.POCKETID_BASE_URL!);

  expect(location.origin).toBe(pocketIdBaseUrl.origin);
  expect(location.pathname).toBe("/authorize");
  expect(location.searchParams.get("response_type")).toBe("code");
  expect(location.searchParams.get("client_id")).toBe(process.env.POCKETID_OIDC_CLIENT_ID);
  expect(location.searchParams.get("redirect_uri")).toBe(
    "http://localhost:3000/api/auth/callback/pocketid",
  );
  expect(location.searchParams.get("scope")).toContain("groups");
  expect(location.searchParams.get("code_challenge_method")).toBe("S256");
  expect(location.searchParams.get("code_challenge")).toBeTruthy();
  // Regression check: Auth.js's default `checks` for a generic OIDC
  // provider is ["pkce"] only, silently omitting `state`. PocketID's
  // /authorize rejects requests with no state param ("invalid_state"),
  // confirmed live against the real test container — this caught it.
  expect(location.searchParams.get("state")).toBeTruthy();
});

test("PocketID's /authorize endpoint accepts the authorization request we build", async ({
  request,
}) => {
  const csrfRes = await request.get("/api/auth/csrf");
  const { csrfToken } = await csrfRes.json();

  const signInRes = await request.post("/api/auth/signin/pocketid", {
    form: { csrfToken },
    maxRedirects: 0,
  });
  const authorizeUrl = signInRes.headers()["location"];

  const authorizeRes = await request.get(authorizeUrl, { maxRedirects: 0 });

  // PocketID redirects to its own /interaction UI once it accepts the
  // request; a 4xx/5xx here means it rejected something we sent (as
  // "invalid_state" did before the fix above).
  expect(authorizeRes.status()).toBe(302);
  expect(authorizeRes.headers()["location"]).toContain("/interaction");
});
