import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";
import { checkDatabase, checkPocketId } from "@/lib/health/checks";

vi.mock("@/lib/db/client", () => ({ getDb: vi.fn(() => ({})) }));
vi.mock("@/lib/pocketid/client", () => ({ getPocketIdConfig: vi.fn(() => ({})) }));
vi.mock("@/lib/health/checks", () => ({
  checkDatabase: vi.fn(),
  checkPocketId: vi.fn(),
}));

const mockDb = vi.mocked(checkDatabase);
const mockPocketId = vi.mocked(checkPocketId);

describe("GET /api/ready", () => {
  beforeEach(() => {
    mockDb.mockReset().mockResolvedValue({ ok: true });
    mockPocketId.mockReset().mockResolvedValue({ ok: true });
  });

  it("returns 200 when every dependency answers", async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      status: "ready",
      checks: { database: { ok: true }, pocketid: { ok: true } },
    });
  });

  it("returns 503 when the database is unreachable", async () => {
    mockDb.mockResolvedValue({ ok: false, error: "unreachable" });

    const res = await GET();

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ status: "not ready" });
  });

  it("returns 503 when PocketID is unreachable", async () => {
    mockPocketId.mockResolvedValue({ ok: false, error: "unreachable" });

    expect((await GET()).status).toBe(503);
  });

  // Both are probed even when the first fails, so one probe tells an
  // operator everything that is wrong rather than only the first thing.
  it("reports both dependencies even when one is already failing", async () => {
    mockDb.mockResolvedValue({ ok: false, error: "db down" });
    mockPocketId.mockResolvedValue({ ok: false, error: "idp down" });

    await (await GET()).json();

    expect(mockDb).toHaveBeenCalled();
    expect(mockPocketId).toHaveBeenCalled();
  });

  // A missing DATABASE_URL throws inside getDb(); a readiness probe must
  // answer 503, not surface a stack trace as a 500.
  it("answers 503 rather than throwing when configuration is missing", async () => {
    const { getDb } = await import("@/lib/db/client");
    vi.mocked(getDb).mockImplementationOnce(() => {
      throw new Error("DATABASE_URL environment variable is not set");
    });

    const res = await GET();

    expect(res.status).toBe(503);
  });

  it("answers 503 rather than throwing when PocketID config is missing", async () => {
    const { getPocketIdConfig } = await import("@/lib/pocketid/client");
    vi.mocked(getPocketIdConfig).mockImplementationOnce(() => {
      throw new Error("POCKETID_BASE_URL environment variable is not set");
    });

    const res = await GET();

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      checks: { pocketid: { ok: false } },
    });
  });

  it("is not cached", async () => {
    expect((await GET()).headers.get("cache-control")).toMatch(/no-store/);
  });
});
