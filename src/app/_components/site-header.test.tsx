import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactElement } from "react";
import { SiteHeader } from "./site-header";
import { setLanguageAction } from "./language-actions";
import { signOut } from "@/auth";
import { setTestLocale } from "@/test/intl";

vi.mock("@/auth", () => ({ signOut: vi.fn() }));
vi.mock("./language-actions", () => ({ setLanguageAction: vi.fn() }));

// SiteHeader is an async server component (it translates itself), so it's
// awaited before rendering; the JSX keeps the call sites readable.
const renderHeader = async (element: ReactElement<ComponentProps<typeof SiteHeader>>) =>
  render(await SiteHeader(element.props));

// See src/app/page.test.tsx: NextAuth's signOut is overloaded, so vi.mocked()
// resolves mockResolvedValue(...) against the wrong signature.
const mockSignOut = signOut as unknown as Mock;

describe("SiteHeader", () => {
  beforeEach(() => {
    mockSignOut.mockReset().mockResolvedValue(undefined as never);
  });

  it("renders a banner landmark with a link back to the portal home", async () => {
    await renderHeader(<SiteHeader name="pocket-portal" user={null} />);

    const banner = screen.getByRole("banner");
    expect(within(banner).getByRole("link", { name: "pocket-portal" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("shows the portal's configured name", async () => {
    await renderHeader(<SiteHeader name="Acme Apps" user={null} />);

    expect(screen.getByRole("link", { name: "Acme Apps" })).toHaveAttribute("href", "/");
  });

  // WCAG 2.2 SC 2.4.1 Bypass Blocks: the repeated header must be skippable,
  // and the skip link has to be the first thing keyboard focus reaches.
  it("puts a skip link to the main landmark first in tab order", async () => {
    await renderHeader(<SiteHeader name="pocket-portal" user={null} />);

    const skipLink = screen.getByRole("link", { name: "Skip to main content" });
    expect(skipLink).toHaveAttribute("href", "#main-content");

    await userEvent.tab();
    expect(skipLink).toHaveFocus();
  });

  it("shows no navigation or sign-out for a signed-out visitor", async () => {
    await renderHeader(<SiteHeader name="pocket-portal" user={null} />);

    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument();
  });

  it("names the navigation landmark so screen readers can distinguish it", async () => {
    await renderHeader(<SiteHeader name="pocket-portal" user={{ name: "Francois", email: null, isAdmin: false }} />);

    expect(screen.getByRole("navigation", { name: "Portal" })).toBeInTheDocument();
  });

  it("links a signed-in user to the catalog, and never to their groups", async () => {
    await renderHeader(<SiteHeader name="pocket-portal" user={{ name: "Francois", email: null, isAdmin: false }} />);

    const nav = screen.getByRole("navigation", { name: "Portal" });
    expect(within(nav).getByRole("link", { name: "Apps" })).toHaveAttribute("href", "/apps");
    // Group memberships are deliberately not shown to users (no My Access page).
    expect(within(nav).queryByRole("link", { name: "My Access" })).not.toBeInTheDocument();
  });

  // PocketID's own logo, light and dark variants, beside the wordmark.
  it("shows PocketID's logo, themed, when branding is available", async () => {
    const { container } = await renderHeader(
      <SiteHeader
        name="pocket-portal"
        user={null}
        logo={{ light: "https://id.example.test/logo?light=true", dark: "https://id.example.test/logo?light=false" }}
      />,
    );

    const source = container.querySelector("picture source");
    expect(source).toHaveAttribute("media", "(prefers-color-scheme: dark)");
    expect(source).toHaveAttribute("srcset", "https://id.example.test/logo?light=false");
    // Decorative: the link's name stays the wordmark.
    const img = container.querySelector("picture img");
    expect(img).toHaveAttribute("src", "https://id.example.test/logo?light=true");
    expect(img).toHaveAttribute("alt", "");
    expect(screen.getByRole("link", { name: "pocket-portal" })).toBeInTheDocument();
  });

  it("shows no logo without branding", async () => {
    const { container } = await renderHeader(<SiteHeader name="pocket-portal" user={null} />);

    expect(container.querySelector("picture")).toBeNull();
  });

  it("hides the Admin link from a non-admin", async () => {
    await renderHeader(<SiteHeader name="pocket-portal" user={{ name: "Francois", email: null, isAdmin: false }} />);

    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
  });

  // One link: the admin pages have their own side menu (admin/layout.tsx).
  it("gives an admin one Admin link, opening on the request queue", async () => {
    await renderHeader(<SiteHeader name="pocket-portal" user={{ name: "Francois", email: null, isAdmin: true }} />);

    const nav = screen.getByRole("navigation", { name: "Portal" });
    expect(within(nav).getByRole("link", { name: "Admin" })).toHaveAttribute(
      "href",
      "/admin/requests",
    );
  });

  // Requests switched off with nothing left to decide: the queue is a dead
  // page, so the link opens on the catalog instead.
  it("opens the Admin link on the catalog when the queue is hidden", async () => {
    await renderHeader(
      <SiteHeader
        name="pocket-portal"
        user={{ name: "Francois", email: null, isAdmin: true }}
        showAccessRequests={false}
      />,
    );

    expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/admin/apps");
  });

  it("signs the user out from the header", async () => {
    await renderHeader(<SiteHeader name="pocket-portal" user={{ name: "Francois", email: null, isAdmin: false }} />);

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(mockSignOut).toHaveBeenCalled();
  });

  describe("language switch", () => {
    // Shown signed out too: the sign-in page is where it's first needed.
    it("offers French, named and marked in French, to a signed-out visitor", async () => {
      await renderHeader(<SiteHeader name="pocket-portal" user={null} />);

      const french = screen.getByRole("button", { name: "Français" });
      expect(french).toHaveAttribute("lang", "fr");
      expect(french).toHaveAttribute("name", "locale");
      expect(french).toHaveAttribute("value", "fr");
      expect(screen.queryByRole("button", { name: "English" })).not.toBeInTheDocument();
    });

    it("submits the chosen language to the language action", async () => {
      await renderHeader(<SiteHeader name="pocket-portal" user={null} />);

      await userEvent.click(screen.getByRole("button", { name: "Français" }));

      const formData = vi.mocked(setLanguageAction).mock.calls[0][0];
      expect(formData.get("locale")).toBe("fr");
    });

    it("speaks French when the page is in French, and offers English back", async () => {
      setTestLocale("fr");

      await renderHeader(
        <SiteHeader name="pocket-portal" user={{ name: "Francois", email: null, isAdmin: true }} />,
      );

      expect(screen.getByRole("navigation", { name: "Portail" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Applications" })).toHaveAttribute("href", "/apps");
      expect(screen.getByRole("link", { name: "Administration" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Se déconnecter" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Aller au contenu principal" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("lang", "en");
    });
  });
});
