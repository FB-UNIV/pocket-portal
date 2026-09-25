import { describe, it, expect } from "vitest";
import { GET } from "./route";

// Liveness. Deliberately dependency-free: if this fails when PocketID or
// Postgres is down, an orchestrator kills instances that are perfectly
// capable of serving again the moment the dependency returns.
describe("GET /api/health", () => {
  it("returns 200 with no dependencies configured at all", async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "ok" });
  });

  it("is not cached by anything in front of it", async () => {
    const res = await GET();

    expect(res.headers.get("cache-control")).toMatch(/no-store/);
  });
});
