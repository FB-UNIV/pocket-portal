import { describe, it, expect, vi } from "vitest";
import { authLogger } from "./auth-logger";

// Auth.js logs through this instead of its own colored console lines, so
// sign-in problems appear in the portal's format, with a stack.
describe("authLogger", () => {
  const log = () => ({ error: vi.fn(), warn: vi.fn(), debug: vi.fn() });

  it("logs Auth.js errors with the error and its type", () => {
    const l = log();
    const err = Object.assign(new Error("state value could not be parsed"), { name: "InvalidCheck" });

    authLogger(l as never).error(err);

    expect(l.error).toHaveBeenCalledWith({ err }, "Auth.js InvalidCheck: state value could not be parsed");
  });

  // A production build minifies class names (name "k"); Auth.js errors carry
  // their type separately.
  it("names the error by its Auth.js type when it has one", () => {
    const l = log();
    const err = Object.assign(new Error("state value could not be parsed"), { name: "k", type: "InvalidCheck" });

    authLogger(l as never).error(err);

    expect(l.error.mock.calls[0][1]).toBe("Auth.js InvalidCheck: state value could not be parsed");
  });

  it("logs warnings by their code", () => {
    const l = log();

    authLogger(l as never).warn("debug-enabled");

    expect(l.warn).toHaveBeenCalledWith("Auth.js warning: debug-enabled");
  });

  // Auth.js calls a custom logger's debug even with its debug option off
  // (@auth/core setLogger), and its metadata carries the sign-in's tokens
  // and profile: "authorization result" holds the access, ID and refresh
  // tokens, the email and the groups. Only the message is ever logged.
  it("logs a debug message alone, never Auth.js's metadata", () => {
    const l = log();

    authLogger(l as never).debug("authorization result", {
      account: { access_token: "at-secret", id_token: "id-secret", refresh_token: "rt-secret" },
      profile: { email: "someone@example.test", groups: ["admins"] },
    });

    expect(l.debug).toHaveBeenCalledWith("Auth.js: authorization result");
    expect(JSON.stringify(l.debug.mock.calls)).not.toMatch(/secret|someone@example\.test|admins/);
  });
});
