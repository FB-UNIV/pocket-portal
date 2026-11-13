import { describe, it, expect, vi, beforeEach } from "vitest";
import { completeTourAction, dismissChecklistAction, tickChecklistItemAction } from "./actions";
import { requireUser } from "@/lib/auth/require-user";
import { getDb } from "@/lib/db/client";
import { completeTour, dismissChecklist, setItemTicked } from "@/lib/onboarding/store";
import { revalidatePath } from "next/cache";

vi.mock("@/lib/auth/require-user", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/onboarding/store", () => ({ dismissChecklist: vi.fn(), setItemTicked: vi.fn(), completeTour: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// #21: the person's own checklist, by their PocketID subject.
describe("checklist actions", () => {
  beforeEach(() => {
    vi.mocked(requireUser).mockReset().mockResolvedValue({ user: { id: "user-1", groups: [] }, expires: "" } as never);
    vi.mocked(getDb).mockReset().mockReturnValue("fake-db" as never);
    vi.mocked(setItemTicked).mockReset();
    vi.mocked(dismissChecklist).mockReset();
    vi.mocked(revalidatePath).mockReset();
  });

  it("ticks and unticks an item the person does themselves", async () => {
    await tickChecklistItemAction("backup-passkey", true);
    await tickChecklistItemAction("backup-passkey", false);

    expect(vi.mocked(setItemTicked).mock.calls).toEqual([
      ["fake-db", "user-1", "backup-passkey", true],
      ["fake-db", "user-1", "backup-passkey", false],
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  // Computed items (requests, prerequisites) follow real state: a form
  // can't tick them.
  it("refuses to tick anything else", async () => {
    await tickChecklistItemAction("request-app", true);
    await tickChecklistItemAction("prerequisite:vpn", true);

    expect(setItemTicked).not.toHaveBeenCalled();
  });

  it("hides the checklist for the person", async () => {
    await dismissChecklistAction();

    expect(requireUser).toHaveBeenCalled();
    expect(dismissChecklist).toHaveBeenCalledWith("fake-db", "user-1");
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });
});

describe("completeTourAction", () => {
  beforeEach(() => {
    vi.mocked(requireUser).mockReset().mockResolvedValue({ user: { id: "user-1", groups: [] }, expires: "" } as never);
    vi.mocked(getDb).mockReset().mockReturnValue("fake-db" as never);
    vi.mocked(completeTour).mockReset();
  });

  // Finished, closed or declined: either way, it isn't offered again until
  // the tour changes.
  it("records that the person has seen this version of the tour", async () => {
    const { TOUR_VERSION } = await import("@/lib/onboarding/tour");

    await completeTourAction();

    expect(completeTour).toHaveBeenCalledWith("fake-db", "user-1", TOUR_VERSION);
  });
});
