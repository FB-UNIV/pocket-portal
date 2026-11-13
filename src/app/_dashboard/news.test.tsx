import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { News } from "./news";
import { listPostsFor } from "@/lib/news/store";
import { getDb } from "@/lib/db/client";

vi.mock("@/lib/db/client", () => ({ getDb: vi.fn(() => ({})) }));
vi.mock("@/lib/news/store", () => ({ listPostsFor: vi.fn() }));
vi.mock("@/lib/observability/logger", () => ({ logger: { error: vi.fn() } }));

const post = (overrides = {}) => ({
  id: "p1",
  title: "Grafana upgrade tonight",
  body: "Back by **10pm**.",
  authorSubject: "admin-1",
  publishedAt: new Date("2026-11-13T09:00:00Z"),
  pinned: false,
  expiresAt: null,
  audienceGroups: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});
const region = () => screen.getByRole("region", { name: "News" });

// #22: news on the dashboard, filtered for the person on the server.
describe("News (dashboard section)", () => {
  beforeEach(() => vi.mocked(listPostsFor).mockReset());

  it("asks only for the posts this person may see", async () => {
    vi.mocked(listPostsFor).mockResolvedValue([]);

    await News({ userGroups: ["engineering"] });

    expect(listPostsFor).toHaveBeenCalledWith({}, ["engineering"], expect.any(Date), 6);
  });

  it("shows each post as an article: title, date, and its words", async () => {
    vi.mocked(listPostsFor).mockResolvedValue([post()]);

    render((await News({ userGroups: [] }))!);

    const article = within(region()).getByRole("article", { name: "Grafana upgrade tonight" });
    expect(within(article).getByText("10pm", { selector: "strong" })).toBeInTheDocument();
    expect(within(article).getByText("Nov 13, 2026")).toBeInTheDocument();
  });

  it("marks a pinned post", async () => {
    vi.mocked(listPostsFor).mockResolvedValue([post({ pinned: true })]);

    render((await News({ userGroups: [] }))!);

    expect(within(region()).getByText("Pinned")).toBeInTheDocument();
  });

  // Five on the dashboard; a sixth means there's more to read.
  it("links to all the news when there's more than fits", async () => {
    vi.mocked(listPostsFor).mockResolvedValue(Array.from({ length: 6 }, (_, i) => post({ id: `p${i}`, title: `Post ${i}` })));

    render((await News({ userGroups: [] }))!);

    expect(within(region()).getAllByRole("article")).toHaveLength(5);
    expect(within(region()).getByRole("link", { name: "All the news" })).toHaveAttribute("href", "/news");
  });

  it("renders nothing when there's no news", async () => {
    vi.mocked(listPostsFor).mockResolvedValue([]);

    expect(await News({ userGroups: [] })).toBeNull();
  });

  // Like any dashboard section (#20): a failure costs the section, which
  // then isn't there, never the page.
  it("renders nothing when the news can't be read", async () => {
    vi.mocked(getDb).mockImplementationOnce(() => {
      throw new Error("DATABASE_URL is not set");
    });

    expect(await News({ userGroups: [] })).toBeNull();
  });
});
