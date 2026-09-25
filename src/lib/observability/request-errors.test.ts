import { describe, it, expect, vi } from "vitest";
import { logRequestError } from "./request-errors";

const context = {
  routerKind: "App Router" as const,
  routePath: "/apps",
  routeType: "render" as const,
  renderSource: "react-server-components" as const,
  revalidateReason: undefined,
  renderType: "dynamic" as const,
};

describe("logRequestError", () => {
  it("logs the error with its stack, the request and the digest users see", () => {
    const log = { error: vi.fn() };
    const err = Object.assign(new TypeError("Cannot read properties of undefined (reading 'map')"), {
      digest: "1234567",
    });

    logRequestError(err, { path: "/apps?x=1", method: "GET", headers: {} }, context, log as never);

    expect(log.error).toHaveBeenCalledTimes(1);
    const [fields, message] = log.error.mock.calls[0];
    expect(message).toBe("GET /apps failed: Cannot read properties of undefined (reading 'map')");
    expect(fields).toMatchObject({
      err,
      digest: "1234567",
      method: "GET",
      path: "/apps",
      route: "/apps",
      routeType: "render",
    });
  });

  it("never logs request headers (cookies, tokens)", () => {
    const log = { error: vi.fn() };

    logRequestError(new Error("x"), { path: "/", method: "GET", headers: { cookie: "session=secret" } }, context, log as never);

    expect(JSON.stringify(log.error.mock.calls[0][0])).not.toContain("secret");
  });

  it("copes with a thrown non-Error", () => {
    const log = { error: vi.fn() };

    logRequestError("boom", { path: "/", method: "POST", headers: {} }, { ...context, routeType: "action" }, log as never);

    expect(log.error.mock.calls[0][1]).toBe("POST / failed: boom");
    expect(log.error.mock.calls[0][0]).toMatchObject({ routeType: "action" });
  });
});
