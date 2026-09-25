import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { requireUser } from "./require-user";
import { auth } from "@/auth";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

// See src/app/page.test.tsx: auth() is overloaded, so vi.mocked() infers
// the wrong call signature for mockResolvedValue(...).
const mockAuth = auth as unknown as Mock;

describe("requireUser", () => {
  beforeEach(() => {
    mockAuth.mockReset();
  });

  it("redirects to sign-in when there is no session", async () => {
    mockAuth.mockResolvedValue(null);

    await expect(requireUser("/apps")).rejects.toThrow("REDIRECT:/?callbackUrl=%2Fapps");
  });

  it("redirects to sign-in when the session predates session.user.id (pre-rollout JWT)", async () => {
    mockAuth.mockResolvedValue({ user: { groups: [] }, expires: "" } as never);

    await expect(requireUser("/apps")).rejects.toThrow("REDIRECT:/?callbackUrl=%2Fapps");
  });

  it("sends to the home page's sign-in when no return path is given", async () => {
    mockAuth.mockResolvedValue(null);

    await expect(requireUser()).rejects.toThrow(/^REDIRECT:\/$/);
  });

  it("returns the session when signed in with an id", async () => {
    const session = { user: { id: "user-1", groups: [] }, expires: "" };
    mockAuth.mockResolvedValue(session as never);

    await expect(requireUser()).resolves.toBe(session);
  });
});
