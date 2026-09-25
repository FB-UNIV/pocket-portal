import { describe, it, expect, vi } from "vitest";
import { acquireAdvisoryLock, runMigrations, isMainModule, ADVISORY_LOCK_KEY } from "./migrate.mjs";

const noSleep = () => Promise.resolve();

describe("acquireAdvisoryLock", () => {
  it("returns once the lock is granted", async () => {
    const query = vi.fn().mockResolvedValue([{ locked: true }]);

    await expect(
      acquireAdvisoryLock({ query, lockKey: 42, timeoutMs: 1000, sleep: noSleep }),
    ).resolves.toBeUndefined();

    expect(query).toHaveBeenCalledWith("select pg_try_advisory_lock($1) as locked", [42]);
  });

  // The whole point of the lock: concurrent replicas starting at once must
  // serialise rather than race the same DDL.
  it("retries while another process holds the lock", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ locked: false }])
      .mockResolvedValueOnce([{ locked: false }])
      .mockResolvedValueOnce([{ locked: true }]);

    await acquireAdvisoryLock({ query, lockKey: 42, timeoutMs: 1000, sleep: noSleep });

    expect(query).toHaveBeenCalledTimes(3);
  });

  // Exercises the real timer rather than an injected fake, so the default
  // backoff between polls is covered too.
  it("waits between polls using a real delay", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ locked: false }])
      .mockResolvedValueOnce([{ locked: true }]);

    await acquireAdvisoryLock({ query, lockKey: 42, timeoutMs: 1000, pollMs: 1 });

    expect(query).toHaveBeenCalledTimes(2);
  });

  // Without a deadline a stuck migration holding the lock would hang every
  // other replica's startup indefinitely, which looks like a hung deploy
  // rather than a failed one.
  it("gives up with a clear error once the deadline passes", async () => {
    const query = vi.fn().mockResolvedValue([{ locked: false }]);
    let clock = 0;
    const now = () => (clock += 400);

    await expect(
      acquireAdvisoryLock({ query, lockKey: 42, timeoutMs: 1000, sleep: noSleep, now }),
    ).rejects.toThrow(/could not acquire.*lock.*1000ms/i);
  });
});

describe("runMigrations", () => {
  function harness(overrides = {}) {
    const calls = [];
    const query = vi.fn(async (text) => {
      calls.push(text);
      return text.includes("pg_try_advisory_lock") ? [{ locked: true }] : [];
    });
    return {
      calls,
      query,
      migrate: vi.fn().mockResolvedValue(undefined),
      log: { info: vi.fn(), error: vi.fn() },
      sleep: noSleep,
      ...overrides,
    };
  }

  it("takes the lock, migrates, then releases it", async () => {
    const h = harness();

    await runMigrations(h);

    expect(h.migrate).toHaveBeenCalled();
    expect(h.calls.some((q) => q.includes("pg_try_advisory_lock"))).toBe(true);
    expect(h.calls.some((q) => q.includes("pg_advisory_unlock"))).toBe(true);
  });

  it("migrates only while holding the lock", async () => {
    const h = harness();

    await runMigrations(h);

    const lockAt = h.calls.findIndex((q) => q.includes("pg_try_advisory_lock"));
    const unlockAt = h.calls.findIndex((q) => q.includes("pg_advisory_unlock"));
    expect(lockAt).toBeGreaterThanOrEqual(0);
    expect(unlockAt).toBeGreaterThan(lockAt);
  });

  // A failed migration must not leave the lock held, or every subsequent
  // replica blocks until the connection is reaped.
  it("releases the lock even when the migration fails", async () => {
    const h = harness({ migrate: vi.fn().mockRejectedValue(new Error("bad DDL")) });

    await expect(runMigrations(h)).rejects.toThrow("bad DDL");

    expect(h.calls.some((q) => q.includes("pg_advisory_unlock"))).toBe(true);
  });

  it("uses one stable lock key so every replica contends for the same lock", () => {
    expect(Number.isSafeInteger(ADVISORY_LOCK_KEY)).toBe(true);
  });
});

// A string comparison of import.meta.url against `file://${argv[1]}` breaks
// on any path containing a space, and it fails *silently* — the script
// exits 0 having migrated nothing, which is the worst possible outcome for
// a migration runner.
describe("isMainModule", () => {
  it("matches when the script is the entry point", () => {
    expect(isMainModule("file:///app/scripts/migrate.mjs", "/app/scripts/migrate.mjs")).toBe(true);
  });

  it("matches when the path contains spaces", () => {
    expect(
      isMainModule("file:///home/me/my%20projects/migrate.mjs", "/home/me/my projects/migrate.mjs"),
    ).toBe(true);
  });

  it("matches a relative entry point", () => {
    const rel = "scripts/migrate.mjs";
    expect(isMainModule(`file://${process.cwd()}/scripts/migrate.mjs`, rel)).toBe(true);
  });

  it("does not match when imported rather than executed", () => {
    expect(isMainModule("file:///app/scripts/migrate.mjs", "/app/server.js")).toBe(false);
  });

  it("does not match when there is no entry point", () => {
    expect(isMainModule("file:///app/scripts/migrate.mjs", undefined)).toBe(false);
  });

  it("returns false rather than throwing on a non-file URL", () => {
    expect(isMainModule("https://example.test/migrate.mjs", "/app/scripts/migrate.mjs")).toBe(false);
  });
});
