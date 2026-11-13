import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { WelcomeChecklist } from "./welcome";
import { listUserCatalogApps } from "@/lib/catalog/apps";
import { listUserAccessRequests } from "@/lib/requests/access-requests";
import { getOnboarding } from "@/lib/onboarding/store";
import { setTestLocale } from "@/test/intl";

vi.mock("@/lib/db/client", () => ({ getDb: vi.fn(() => ({})) }));
vi.mock("@/lib/pocketid/client", () => ({ getPocketIdConfig: vi.fn(() => ({})) }));
vi.mock("@/lib/catalog/apps", () => ({ listUserCatalogApps: vi.fn() }));
vi.mock("@/lib/requests/access-requests", () => ({ listUserAccessRequests: vi.fn() }));
vi.mock("@/lib/onboarding/store", () => ({ getOnboarding: vi.fn() }));
vi.mock("@/lib/observability/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("./actions", () => ({ tickChecklistItemAction: vi.fn(), dismissChecklistAction: vi.fn() }));

const NOT_STARTED = { checklistDismissedAt: null, tickedItems: [], tourCompletedAt: null, tourVersion: null };
const region = () => screen.getByRole("region", { name: "Getting started" });

describe("WelcomeChecklist (dashboard section)", () => {
  beforeEach(() => {
    vi.stubEnv("POCKETID_BASE_URL", "https://id.example.test/");
    vi.mocked(listUserCatalogApps).mockReset().mockResolvedValue([]);
    vi.mocked(listUserAccessRequests).mockReset().mockResolvedValue([]);
    vi.mocked(getOnboarding).mockReset().mockResolvedValue(NOT_STARTED);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("lists what's left to do, with how far along they are", async () => {
    render((await WelcomeChecklist({ userId: "user-1", userGroups: [] }))!);

    expect(within(region()).getByText("0 of 3 done")).toBeInTheDocument();
    expect(within(region()).getByRole("heading", { name: "Add a backup passkey" })).toBeInTheDocument();
    expect(within(region()).getByRole("link", { name: "Open your account" })).toHaveAttribute(
      "href",
      "https://id.example.test/settings/account",
    );
    expect(within(region()).getByRole("button", { name: "I’ve done it" })).toBeInTheDocument();
    expect(within(region()).getByRole("heading", { name: "Ask for an app you need" })).toBeInTheDocument();
    expect(within(region()).getByRole("button", { name: "Hide this" })).toBeInTheDocument();
  });

  it("marks done what's done, and lets a self-ticked item be undone", async () => {
    vi.mocked(getOnboarding).mockResolvedValue({ ...NOT_STARTED, tickedItems: ["backup-passkey"] });

    render((await WelcomeChecklist({ userId: "user-1", userGroups: [] }))!);

    expect(within(region()).getByText("1 of 3 done")).toBeInTheDocument();
    expect(within(region()).getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });

  it("names an app that other apps of theirs need", async () => {
    vi.mocked(listUserCatalogApps).mockResolvedValue([
      {
        id: "grafana",
        name: "Grafana",
        description: "",
        launchUrl: "https://grafana.example.test",
        iconUrl: null,
        category: null,
        hasAccess: true,
        allowedGroups: [],
        requires: [{ id: "vpn", name: "VPN", hasAccess: false, allowedGroups: [] }],
      },
    ]);

    render((await WelcomeChecklist({ userId: "user-1", userGroups: [] }))!);

    expect(within(region()).getByRole("heading", { name: "Get VPN" })).toBeInTheDocument();
    expect(within(region()).getByText("Grafana only works with it.")).toBeInTheDocument();
  });

  it("renders nothing once dismissed, or once everything's done", async () => {
    vi.mocked(getOnboarding).mockResolvedValue({ ...NOT_STARTED, checklistDismissedAt: new Date() });
    expect(await WelcomeChecklist({ userId: "user-1", userGroups: [] })).toBeNull();

    vi.mocked(getOnboarding).mockResolvedValue({
      ...NOT_STARTED,
      tickedItems: ["backup-passkey"],
      tourCompletedAt: new Date(),
      tourVersion: 1,
    });
    vi.mocked(listUserAccessRequests).mockResolvedValue([{ id: "r1" } as never]);
    expect(await WelcomeChecklist({ userId: "user-1", userGroups: [] })).toBeNull();
  });

  // Like any dashboard section (#20): a failure costs the checklist, which
  // then just isn't there, never the page.
  it("renders nothing when it can't load", async () => {
    vi.mocked(getOnboarding).mockRejectedValue(new Error("db down"));

    expect(await WelcomeChecklist({ userId: "user-1", userGroups: [] })).toBeNull();
  });

  it("speaks French", async () => {
    setTestLocale("fr");
    try {
      render((await WelcomeChecklist({ userId: "user-1", userGroups: [] }))!);

      expect(screen.getByRole("region", { name: "Pour bien commencer" })).toBeInTheDocument();
      expect(screen.getByText("0 sur 3 fait")).toBeInTheDocument();
    } finally {
      setTestLocale("en");
    }
  });
});

describe("WelcomeChecklist: the tour", () => {
  beforeEach(() => {
    vi.stubEnv("POCKETID_BASE_URL", "https://id.example.test/");
    vi.mocked(listUserCatalogApps).mockReset().mockResolvedValue([]);
    vi.mocked(listUserAccessRequests).mockReset().mockResolvedValue([]);
    vi.mocked(getOnboarding).mockReset().mockResolvedValue(NOT_STARTED);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("offers to look around the dashboard, starting the tour", async () => {
    render((await WelcomeChecklist({ userId: "user-1", userGroups: [] }))!);

    expect(within(region()).getByRole("heading", { name: "Look around the dashboard" })).toBeInTheDocument();
    expect(within(region()).getByRole("link", { name: "Take the tour" })).toHaveAttribute("href", "/?tour=1");
  });
});
