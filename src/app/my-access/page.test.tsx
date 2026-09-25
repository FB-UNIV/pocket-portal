import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen } from "@testing-library/react";
import MyAccessPage, { metadata } from "./page";
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

describe("MyAccessPage", () => {
  beforeEach(() => {
    mockAuth.mockReset();
  });

  it("redirects to sign-in when there is no session", async () => {
    mockAuth.mockResolvedValue(null);

    await expect(MyAccessPage()).rejects.toThrow("REDIRECT:/?callbackUrl=%2Fmy-access");
  });

  it("shows an empty state when the user has no groups", async () => {
    mockAuth.mockResolvedValue({ user: { groups: [] }, expires: "" } as never);

    render(await MyAccessPage());

    expect(screen.getByText("You don't belong to any PocketID groups yet.")).toBeInTheDocument();
  });

  it("lists the user's groups", async () => {
    mockAuth.mockResolvedValue({
      user: { groups: ["admins", "media"] },
      expires: "",
    } as never);

    render(await MyAccessPage());

    expect(screen.getByText("admins")).toBeInTheDocument();
    expect(screen.getByText("media")).toBeInTheDocument();
  });

  // WCAG 2.2 SC 2.4.2 Page Titled.
  it("declares its own page title", () => {
    expect(metadata.title).toBe("My Access");
  });

  // SC 2.4.1 Bypass Blocks — target for the header's skip link.
  it("exposes a focusable main landmark for the skip link", async () => {
    mockAuth.mockResolvedValue({ user: { groups: [] }, expires: "" } as never);

    render(await MyAccessPage());

    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "main-content");
    expect(main).toHaveAttribute("tabindex", "-1");
  });
});
