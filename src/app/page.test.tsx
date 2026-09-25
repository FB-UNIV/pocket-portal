import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Home from "./page";
import { auth, signIn } from "@/auth";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@/lib/pocketid/branding", () => ({ getPortalName: vi.fn().mockResolvedValue("Acme Apps") }));

// auth()/signIn() are overloaded (NextAuth also exposes them as
// middleware/route-handler-compatible signatures); vi.mocked() picks up the
// full overloaded type and mockResolvedValue(...) resolves against the
// wrong one. Cast to a plain Mock instead.
const mockAuth = auth as unknown as Mock;
const mockSignIn = signIn as unknown as Mock;

const session = (overrides: Record<string, unknown> = {}) =>
  ({
    user: { name: "Francois", email: "f@example.test", groups: [], isAdmin: false, ...overrides },
    expires: "",
  }) as never;

describe("Home", () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockSignIn.mockReset().mockResolvedValue(undefined as never);
  });

  it("shows a sign-in button when there is no session", async () => {
    mockAuth.mockResolvedValue(null);

    render(await Home());

    expect(screen.getByRole("button", { name: "Sign in with PocketID" })).toBeInTheDocument();
    expect(screen.queryByText(/Signed in as/)).not.toBeInTheDocument();
  });

  it("calls signIn('pocketid') when the sign-in button is submitted", async () => {
    mockAuth.mockResolvedValue(null);
    render(await Home());

    await userEvent.click(screen.getByRole("button", { name: "Sign in with PocketID" }));

    expect(mockSignIn).toHaveBeenCalledWith("pocketid");
  });

  it("shows the signed-in user and links on to the portal's two entry points", async () => {
    mockAuth.mockResolvedValue(session());

    render(await Home());

    expect(screen.getByText("Signed in as Francois")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "My Access" })).toHaveAttribute(
      "href",
      "/my-access",
    );
    expect(screen.getByRole("link", { name: "Browse apps" })).toHaveAttribute("href", "/apps");
  });

  it("falls back to email when the session user has no name", async () => {
    mockAuth.mockResolvedValue(session({ name: null }));

    render(await Home());

    expect(screen.getByText("Signed in as f@example.test")).toBeInTheDocument();
  });

  // SC 2.4.1 Bypass Blocks: the header's skip link targets #main-content, so
  // every page has to provide that target as a focusable main landmark.
  it("exposes a focusable main landmark for the skip link", async () => {
    mockAuth.mockResolvedValue(null);

    render(await Home());

    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "main-content");
    expect(main).toHaveAttribute("tabindex", "-1");
  });

  it("headlines the page with the portal's name", async () => {
    mockAuth.mockResolvedValue(null);

    render(await Home());

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Acme Apps");
  });
});
