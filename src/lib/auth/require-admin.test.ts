import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { requireAdmin } from "./require-admin";
import { auth } from "@/auth";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

// Mirrors next/navigation's real redirect(): it throws to interrupt
// rendering rather than returning, so callers never fall through past it.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

// auth() is overloaded (plain call vs. middleware-wrapping call); vi.mocked()
// picks up that full overloaded type and makes mockResolvedValue(...) resolve
// against the wrong signature. Cast to a plain Mock instead.
const mockAuth = auth as unknown as Mock;

describe("requireAdmin", () => {
  beforeEach(() => {
    mockAuth.mockReset();
  });

  it("redirects to sign-in when there is no session", async () => {
    mockAuth.mockResolvedValue(null);

    await expect(requireAdmin()).rejects.toThrow("REDIRECT:/api/auth/signin/pocketid");
  });

  it("redirects home when the signed-in user is not an admin", async () => {
    mockAuth.mockResolvedValue({ user: { isAdmin: false } } as never);

    await expect(requireAdmin()).rejects.toThrow("REDIRECT:/");
  });

  it("returns the session when the signed-in user is an admin", async () => {
    const session = { user: { isAdmin: true } };
    mockAuth.mockResolvedValue(session as never);

    await expect(requireAdmin()).resolves.toBe(session);
  });
});
