import { describe, it, expect } from "vitest";
import { buildContentSecurityPolicy, originOf, SECURITY_HEADERS } from "./csp";

function directives(csp: string) {
  return Object.fromEntries(
    csp.split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
      const [name, ...values] = d.split(/\s+/);
      return [name, values];
    }),
  );
}

describe("buildContentSecurityPolicy", () => {
  const csp = directives(
    buildContentSecurityPolicy({ nonce: "abc123", pocketIdOrigin: "https://id.example.test", dev: false }),
  );

  // The clickjacking fix: no site may frame the admin Approve button.
  it("forbids framing the portal", () => {
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
  });

  it("runs only nonced scripts, and what they load", () => {
    expect(csp["script-src"]).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'"]);
    expect(csp["object-src"]).toEqual(["'none'"]);
    expect(csp["base-uri"]).toEqual(["'self'"]);
  });

  // Sign-in submits a form whose response redirects to PocketID's /authorize,
  // and form-action applies to that redirect; the logo is served by PocketID.
  it("allows PocketID for the sign-in redirect and the logo", () => {
    expect(csp["form-action"]).toEqual(["'self'", "https://id.example.test"]);
    expect(csp["img-src"]).toEqual(["'self'", "data:", "https://id.example.test"]);
  });

  it("allows only same-origin connections, fonts and a default of self", () => {
    expect(csp["default-src"]).toEqual(["'self'"]);
    expect(csp["connect-src"]).toEqual(["'self'"]);
    expect(csp["font-src"]).toEqual(["'self'"]);
  });

  // Next's dev server evaluates code for fast refresh.
  it("adds unsafe-eval only in development", () => {
    const dev = directives(buildContentSecurityPolicy({ nonce: "n", pocketIdOrigin: undefined, dev: true }));
    expect(dev["script-src"]).toContain("'unsafe-eval'");
    expect(csp["script-src"]).not.toContain("'unsafe-eval'");
  });

  it("leaves PocketID out when it isn't configured", () => {
    const bare = directives(buildContentSecurityPolicy({ nonce: "n", pocketIdOrigin: undefined, dev: false }));
    expect(bare["form-action"]).toEqual(["'self'"]);
    expect(bare["img-src"]).toEqual(["'self'", "data:"]);
  });

  // Plain-HTTP localhost dev and e2e would break; TLS is the proxy's job.
  it("doesn't force HTTPS upgrades", () => {
    expect(csp).not.toHaveProperty("upgrade-insecure-requests");
  });
});

// The proxy runs this on every page request, so a malformed
// POCKETID_BASE_URL must degrade the CSP, not 500 every page.
describe("originOf", () => {
  it("returns the origin of an absolute http(s) URL", () => {
    expect(originOf("https://id.example.test/some/path")).toBe("https://id.example.test");
    expect(originOf("http://127.0.0.1:1411")).toBe("http://127.0.0.1:1411");
  });

  it.each([undefined, "", "id.example.test", "not a url", "javascript:alert(1)"])(
    "returns undefined for %s, rather than throwing",
    (value) => {
      expect(originOf(value)).toBeUndefined();
    },
  );
});

describe("SECURITY_HEADERS", () => {
  const headers = Object.fromEntries(SECURITY_HEADERS.map((h) => [h.key, h.value]));

  it("sets the static hardening headers", () => {
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toMatch(/camera=\(\)/);
  });
});
