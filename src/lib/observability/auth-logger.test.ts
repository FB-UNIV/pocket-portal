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

  it("logs debug messages at debug", () => {
    const l = log();

    authLogger(l as never).debug("callback", { provider: "pocketid" });

    expect(l.debug).toHaveBeenCalledWith({ metadata: { provider: "pocketid" } }, "Auth.js: callback");
  });
});
