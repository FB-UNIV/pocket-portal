import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SiteHeader } from "./site-header";
import { signOut } from "@/auth";

vi.mock("@/auth", () => ({ signOut: vi.fn() }));

// See src/app/page.test.tsx: NextAuth's signOut is overloaded, so vi.mocked()
// resolves mockResolvedValue(...) against the wrong signature.
const mockSignOut = signOut as unknown as Mock;

describe("SiteHeader", () => {
  beforeEach(() => {
    mockSignOut.mockReset().mockResolvedValue(undefined as never);
  });

  it("renders a banner landmark with a link back to the portal home", () => {
    render(<SiteHeader name="pocket-portal" user={null} />);

    const banner = screen.getByRole("banner");
    expect(within(banner).getByRole("link", { name: "pocket-portal" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("shows the portal's configured name", () => {
    render(<SiteHeader name="Acme Apps" user={null} />);

    expect(screen.getByRole("link", { name: "Acme Apps" })).toHaveAttribute("href", "/");
  });

  // WCAG 2.2 SC 2.4.1 Bypass Blocks: the repeated header must be skippable,
  // and the skip link has to be the first thing keyboard focus reaches.
  it("puts a skip link to the main landmark first in tab order", async () => {
    render(<SiteHeader name="pocket-portal" user={null} />);

    const skipLink = screen.getByRole("link", { name: "Skip to main content" });
    expect(skipLink).toHaveAttribute("href", "#main-content");

    await userEvent.tab();
    expect(skipLink).toHaveFocus();
  });

  it("shows no navigation or sign-out for a signed-out visitor", () => {
    render(<SiteHeader name="pocket-portal" user={null} />);

    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument();
  });

  it("names the navigation landmark so screen readers can distinguish it", () => {
    render(<SiteHeader name="pocket-portal" user={{ name: "Francois", email: null, isAdmin: false }} />);

    expect(screen.getByRole("navigation", { name: "Portal" })).toBeInTheDocument();
  });

  it("links a signed-in user to their access and the catalog", () => {
    render(<SiteHeader name="pocket-portal" user={{ name: "Francois", email: null, isAdmin: false }} />);

    const nav = screen.getByRole("navigation", { name: "Portal" });
    expect(within(nav).getByRole("link", { name: "My Access" })).toHaveAttribute(
      "href",
      "/my-access",
    );
    expect(within(nav).getByRole("link", { name: "Apps" })).toHaveAttribute("href", "/apps");
  });

  // PocketID's own logo, light and dark variants, beside the wordmark.
  it("shows PocketID's logo, themed, when branding is available", () => {
    const { container } = render(
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

  it("shows no logo without branding", () => {
    const { container } = render(<SiteHeader name="pocket-portal" user={null} />);

    expect(container.querySelector("picture")).toBeNull();
  });

  it("hides the admin links from a non-admin", () => {
    render(<SiteHeader name="pocket-portal" user={{ name: "Francois", email: null, isAdmin: false }} />);

    expect(screen.queryByRole("link", { name: "App Catalog" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Access Requests" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Audit Log" })).not.toBeInTheDocument();
  });

  it("shows the admin links to an admin", () => {
    render(<SiteHeader name="pocket-portal" user={{ name: "Francois", email: null, isAdmin: true }} />);

    const nav = screen.getByRole("navigation", { name: "Portal" });
    expect(within(nav).getByRole("link", { name: "App Catalog" })).toHaveAttribute(
      "href",
      "/admin/apps",
    );
    expect(within(nav).getByRole("link", { name: "Access Requests" })).toHaveAttribute(
      "href",
      "/admin/requests",
    );
    expect(within(nav).getByRole("link", { name: "Audit Log" })).toHaveAttribute(
      "href",
      "/admin/audit",
    );
  });

  // with requests off, the queue link shows only while there is
  // something left to decide.
  it("can hide the Audit Log link from an admin", () => {
    render(
      <SiteHeader name="pocket-portal" user={{ name: "Francois", email: null, isAdmin: true }} showAuditLog={false} />,
    );

    expect(screen.queryByRole("link", { name: "Audit Log" })).not.toBeInTheDocument();
  });

  it("can hide the Access Requests link from an admin", () => {
    render(
      <SiteHeader
        name="pocket-portal"
        user={{ name: "Francois", email: null, isAdmin: true }}
        showAccessRequests={false}
      />,
    );

    expect(screen.queryByRole("link", { name: "Access Requests" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "App Catalog" })).toBeInTheDocument();
  });

  it("signs the user out from the header", async () => {
    render(<SiteHeader name="pocket-portal" user={{ name: "Francois", email: null, isAdmin: false }} />);

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(mockSignOut).toHaveBeenCalled();
  });
});
