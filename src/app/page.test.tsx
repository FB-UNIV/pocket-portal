import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Home from "./page";
import { auth, signIn } from "@/auth";
import { setTestLocale } from "@/test/intl";
import { getPocketIdBranding } from "@/lib/pocketid/branding";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));
const BACKGROUND = "https://id.example.test/api/application-images/background";
vi.mock("@/lib/pocketid/branding", () => ({
  getPortalName: vi.fn().mockResolvedValue("Acme Apps"),
  getPocketIdBranding: vi.fn(),
}));
const mockBranding = getPocketIdBranding as unknown as Mock;
// The dashboard's sections are async server components (tested on their
// own); here a stub stands in, so the page's own layout can be rendered.
vi.mock("./_dashboard/your-apps", () => ({
  YourApps: ({ userGroups }: { userGroups: string[] }) => (
    <section aria-label="Your apps" data-groups={userGroups.join(",")} />
  ),
  YourAppsLoading: () => null,
}));

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
    mockBranding.mockReset().mockResolvedValue({ colors: null, name: null, background: BACKGROUND });
    vi.unstubAllEnvs();
  });

  // The redesign (sign-in canvas): a headline, one line, one big button.
  it("keeps the sign-in page to a headline, a tagline and the button", async () => {
    mockAuth.mockResolvedValue(null);

    render(await Home());

    expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual(["Welcome to Acme Apps"]);
    expect(screen.getByText("All our apps, one sign-in.")).toBeInTheDocument();
    expect(screen.getByText(/First time\?/)).toBeInTheDocument();
  });

  it("shows PocketID's background image beside the button, as decoration", async () => {
    mockAuth.mockResolvedValue(null);

    const { container } = render(await Home());

    const image = container.querySelector(`img[src="${BACKGROUND}"]`);
    expect(image).not.toBeNull();
    expect(image).toHaveAttribute("alt", "");
  });

  it("falls back to the portal's own panel when PocketID's branding is off or unreachable", async () => {
    mockAuth.mockResolvedValue(null);
    mockBranding.mockResolvedValue(null);

    const { container } = render(await Home());

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("uses the deployer's headline and tagline for the page's language", async () => {
    vi.stubEnv("SIGNIN_HEADLINE_EN", "The Smiths' apps");
    vi.stubEnv("SIGNIN_TAGLINE_EN", "Films, photos and files.");
    mockAuth.mockResolvedValue(null);

    render(await Home());

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("The Smiths' apps");
    expect(screen.getByText("Films, photos and files.")).toBeInTheDocument();
  });

  it("drops the invite hint when SIGNIN_INVITE_HINT is off", async () => {
    vi.stubEnv("SIGNIN_INVITE_HINT", "false");
    mockAuth.mockResolvedValue(null);

    render(await Home());

    expect(screen.queryByText(/First time\?/)).not.toBeInTheDocument();
  });

  it("shows a sign-in button when there is no session", async () => {
    mockAuth.mockResolvedValue(null);

    render(await Home());

    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByText(/Signed in as/)).not.toBeInTheDocument();
  });

  it("calls signIn('pocketid') when the sign-in button is submitted", async () => {
    mockAuth.mockResolvedValue(null);
    render(await Home());

    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(mockSignIn).toHaveBeenCalledWith("pocketid", { redirectTo: "/" });
  });

  it("signs in back to the page the visitor was headed for", async () => {
    mockAuth.mockResolvedValue(null);
    render(await Home({ searchParams: Promise.resolve({ callbackUrl: "/apps" }) }));

    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(mockSignIn).toHaveBeenCalledWith("pocketid", { redirectTo: "/apps" });
  });

  it("ignores a return path that leaves the portal", async () => {
    mockAuth.mockResolvedValue(null);
    render(await Home({ searchParams: Promise.resolve({ callbackUrl: "//evil.test" }) }));

    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(mockSignIn).toHaveBeenCalledWith("pocketid", { redirectTo: "/" });
  });

  it("greets the signed-in user by first name", async () => {
    mockAuth.mockResolvedValue(session({ name: "Francois Bouju" }));

    render(await Home());

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Hi Francois.");
    expect(screen.getByText("Signed in as Francois Bouju")).toBeInTheDocument();
  });

  // #20: the signed-in home is the dashboard, starting with the user's apps.
  it("shows the dashboard's Your apps section, for the user's groups", async () => {
    mockAuth.mockResolvedValue(session({ groups: ["media", "vpn"] }));

    render(await Home());

    expect(screen.getByRole("region", { name: "Your apps" })).toHaveAttribute(
      "data-groups",
      "media,vpn",
    );
    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("doesn't load the dashboard for a signed-out visitor", async () => {
    mockAuth.mockResolvedValue(null);

    render(await Home());

    expect(screen.queryByRole("region", { name: "Your apps" })).not.toBeInTheDocument();
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

  it("welcomes a signed-out visitor in French when the page is in French", async () => {
    setTestLocale("fr");
    mockAuth.mockResolvedValue(null);

    render(await Home());

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Bienvenue sur Acme Apps");
    expect(screen.getByRole("button", { name: "Se connecter" })).toBeInTheDocument();
  });

  it("greets a signed-in user in French, with or without a name", async () => {
    setTestLocale("fr");
    mockAuth.mockResolvedValue(session({ name: "Francois Bouju" }));
    const { unmount } = render(await Home());
    // A narrow no-break space before "?", as French typography wants.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Bonjour Francois. Que voulez-vous faire\u202f?",
      { normalizeWhitespace: false },
    );
    unmount();

    mockAuth.mockResolvedValue(session({ name: null }));
    render(await Home());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Bonjour. Que voulez-vous faire\u202f?",
      { normalizeWhitespace: false },
    );
  });
});
