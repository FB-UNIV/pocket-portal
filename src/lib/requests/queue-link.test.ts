import { describe, it, expect, vi } from "vitest";
import { showAccessRequestsLink } from "./queue-link";

describe("showAccessRequestsLink", () => {
  it("always shows it while requests are switched on, without asking the DB", async () => {
    const hasPending = vi.fn();

    await expect(showAccessRequestsLink(true, hasPending)).resolves.toBe(true);
    expect(hasPending).not.toHaveBeenCalled();
  });

  // Switched off, the queue stays reachable only to drain what was filed.
  it.each([
    [true, true],
    [false, false],
  ])("with requests off, shows it only while something is pending (%s)", async (pending, shown) => {
    await expect(showAccessRequestsLink(false, async () => pending)).resolves.toBe(shown);
  });

  // A nav link isn't worth failing every admin page over.
  it("shows it when the queue can't be read", async () => {
    await expect(
      showAccessRequestsLink(false, async () => {
        throw new Error("db down");
      }),
    ).resolves.toBe(true);
  });
});
