import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen } from "@testing-library/react";
import AdminLayout from "./layout";
import { PocketIdSecretsBanner } from "@/app/_components/pocketid-secrets-banner";

vi.mock("@/app/_components/pocketid-secrets-banner", () => ({
  PocketIdSecretsBanner: vi.fn(),
}));

// The real banner is an async server component. React renders a synchronous
// stub here happily, so the cast narrows the mock to what we actually return
// rather than dressing each element up as a Promise.
const mockBanner = vi.mocked(PocketIdSecretsBanner) as unknown as Mock<() => React.ReactNode>;

// The layout exists so the secrets warning covers *every* /admin page;
// dropping it would silently un-warn admins on pages that still render fine.
describe("AdminLayout", () => {
  beforeEach(() => {
    mockBanner.mockReset();
    mockBanner.mockReturnValue(<div data-testid="banner" />);
  });

  const props = { params: Promise.resolve({}) } as Parameters<typeof AdminLayout>[0];

  it("renders the secrets banner above the page", () => {
    render(<AdminLayout {...props}>{<main>Apps</main>}</AdminLayout>);

    const banner = screen.getByTestId("banner");
    const page = screen.getByRole("main");
    expect(banner).toBeInTheDocument();
    expect(banner.compareDocumentPosition(page)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("renders the admin page itself", () => {
    render(<AdminLayout {...props}>{<main>Requests</main>}</AdminLayout>);

    expect(screen.getByRole("main")).toHaveTextContent("Requests");
  });

  it("still renders the page when the banner renders nothing", () => {
    mockBanner.mockReturnValue(null);

    render(<AdminLayout {...props}>{<main>Apps</main>}</AdminLayout>);

    expect(screen.queryByTestId("banner")).not.toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveTextContent("Apps");
  });
});
