import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { DashboardSection, SectionError, loadSection } from "./section";
import { logger } from "@/lib/observability/logger";

vi.mock("@/lib/observability/logger", () => ({ logger: { error: vi.fn() } }));

// The contract every dashboard section follows (#20), so the onboarding
// checklist (#21), news (#22) and integration widgets (#23) slot in the
// same way "Your apps" does.
describe("DashboardSection", () => {
  it("is a region named by its heading, whatever state it's in", () => {
    render(
      <DashboardSection id="news" heading="News">
        <p>Body</p>
      </DashboardSection>,
    );

    const region = screen.getByRole("region", { name: "News" });
    expect(within(region).getByRole("heading", { level: 2, name: "News" })).toBeInTheDocument();
    expect(within(region).getByText("Body")).toBeInTheDocument();
    expect(region).not.toHaveAttribute("aria-busy");
  });

  it("keeps two sections on one page apart", () => {
    render(
      <>
        <DashboardSection id="your-apps" heading="Your apps">
          <p>a</p>
        </DashboardSection>
        <DashboardSection id="news" heading="News">
          <p>b</p>
        </DashboardSection>
      </>,
    );

    expect(within(screen.getByRole("region", { name: "Your apps" })).getByText("a")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "News" })).getByText("b")).toBeInTheDocument();
  });

  it("says it's busy while loading, and shows the action beside the heading", () => {
    render(
      <DashboardSection id="news" heading="News" busy action={<a href="/news">All news</a>}>
        <p>Loading…</p>
      </DashboardSection>,
    );

    const region = screen.getByRole("region", { name: "News" });
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(within(region).getByRole("link", { name: "All news" })).toHaveAttribute("href", "/news");
  });
});

describe("SectionError", () => {
  it("says what failed, that it's brief, and offers to try again", () => {
    render(<SectionError title="We couldn’t load the news." detail="It’s usually brief." tryAgain="Try again" />);

    expect(screen.getByText("We couldn’t load the news.")).toBeInTheDocument();
    expect(screen.getByText(/It’s usually brief\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/");
  });
});

describe("loadSection", () => {
  beforeEach(() => vi.mocked(logger.error).mockReset());

  it("hands back what the section loaded", async () => {
    await expect(loadSection("News", async () => [1, 2])).resolves.toEqual({ ok: true, value: [1, 2] });
    expect(logger.error).not.toHaveBeenCalled();
  });

  // One section failing (PocketID slow, an integration down) costs that
  // section, never the whole dashboard.
  it("turns a failure into a result, and logs it with the section's name", async () => {
    const err = new Error("timed out");

    await expect(loadSection("News", () => Promise.reject(err))).resolves.toEqual({ ok: false });
    expect(logger.error).toHaveBeenCalledWith({ err }, "Dashboard: News failed to load");
  });

  it("catches a loader that throws before it returns a promise", async () => {
    const err = new Error("bad config");

    await expect(
      loadSection("News", () => {
        throw err;
      }),
    ).resolves.toEqual({ ok: false });
    expect(logger.error).toHaveBeenCalledWith({ err }, "Dashboard: News failed to load");
  });
});
