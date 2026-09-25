import { describe, it, expect, vi } from "vitest";
import { checkDatabase, checkPocketId } from "./checks";

describe("checkDatabase", () => {

  it("reports ok when the database answers a trivial query", async () => {
    const execute = vi.fn().mockResolvedValue([{ "?column?": 1 }]);
    const db = { transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb({ execute })) };

    await expect(checkDatabase(db as never)).resolves.toEqual({ ok: true });
  });

  // Racing a promise leaves the query running server-side. The probe runs
  // inside a transaction that sets statement_timeout, so Postgres kills it
  // rather than leaving work behind every time readiness is scraped.
  it("bounds the query server-side with statement_timeout", async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const db = { transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb({ execute })) };

    await checkDatabase(db as never, 1500);

    const statements = execute.mock.calls.map(([q]) => JSON.stringify(q));
    expect(statements.some((q) => /statement_timeout/.test(q) && /1500/.test(q))).toBe(true);
  });

  // The message is surfaced to an unauthenticated probe, so it must not
  // carry the connection string or anything else from the driver's error.
  it("reports not-ok without leaking the driver error", async () => {
    const db = {
      transaction: vi
        .fn()
        .mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:5432 password=hunter2")),
    };

    const result = await checkDatabase(db as never);

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/hunter2|10\.0\.0\.5/);
  });

  // postgres.js 3.4.9 can leave an initial query pending indefinitely after
  // a clean socket close, and connect_timeout does not bound that case. If
  // readiness awaited it directly, /api/ready would hang instead of
  // answering 503 — the exact failure the PocketID timeout exists to avoid.
  it("answers rather than hanging when the driver never settles", async () => {
    const db = { transaction: vi.fn(() => new Promise(() => {})) };

    const result = await checkDatabase(db as never, 10);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/timed out after 10ms/i);
  });
});

describe("checkPocketId", () => {
  const config = { baseUrl: "https://id.example.test", apiKey: "k" };

  it("reports ok when discovery responds", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    await expect(checkPocketId(config as never, fetchImpl as never)).resolves.toEqual({ ok: true });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://id.example.test/.well-known/openid-configuration",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("reports not-ok on a non-2xx discovery response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503 });

    const result = await checkPocketId(config as never, fetchImpl as never);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/503/);
  });

  // A readiness probe that hangs is worse than one that fails: the
  // orchestrator waits instead of routing away from the instance. This
  // drives the real timer and the real AbortSignal rather than a
  // pre-baked rejection, so the timeout path itself is exercised.
  it("aborts and reports not-ok when PocketID never answers", async () => {
    const hangingFetch = (_url: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      });

    const result = await checkPocketId(config as never, hangingFetch as never, 5);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/timed out after 5ms/i);
  });

  it("reports not-ok without leaking the network error", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new Error("getaddrinfo ENOTFOUND id.internal.example"));

    const result = await checkPocketId(config as never, fetchImpl as never);

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/ENOTFOUND|id\.internal/);
  });
});
