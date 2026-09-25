import { describe, it, expect } from "vitest";
import { safeCallbackUrl, signInUrl } from "./sign-in-redirect";

// Signed-out visitors go to the portal's home page, which signs in with a
// POST (Auth.js v5 answers a GET to /api/auth/signin/<provider> with its
// "Configuration" error page), and come back where they were headed.
describe("signInUrl", () => {
  it("returns to the page the visitor asked for", () => {
    expect(signInUrl("/apps")).toBe("/?callbackUrl=%2Fapps");
    expect(signInUrl("/admin/requests")).toBe("/?callbackUrl=%2Fadmin%2Frequests");
  });

  it("is the home page alone without one, or with an unsafe one", () => {
    expect(signInUrl()).toBe("/");
    expect(signInUrl("//evil.test")).toBe("/");
  });
});

describe("safeCallbackUrl", () => {
  it.each(["/apps", "/admin/requests?status=pending", "/"])("keeps %s", (value) => {
    expect(safeCallbackUrl(value)).toBe(value);
  });

  // An open redirect would let a link through the portal land on any site.
  it.each([
    ["another origin", "https://evil.test/"],
    ["a protocol-relative URL", "//evil.test"],
    ["a backslash trick", "/\\evil.test"],
    ["a relative path", "apps"],
    ["nothing", undefined],
    ["a repeated parameter", ["/apps", "/admin"]],
  ])("falls back to / for %s", (_why, value) => {
    expect(safeCallbackUrl(value)).toBe("/");
  });
});
