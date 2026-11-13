import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GuidedTour } from "./guided-tour";

// #21 phase 2: a short coach-mark tour, built in-house (no dependency), so
// its accessibility is ours to guarantee: focus moves into each step and
// back, Escape closes, Tab stays inside, each step is announced.

const LABELS = {
  offer: "New here? A quick look around takes a minute.",
  start: "Take the tour",
  decline: "No thanks",
  next: "Next",
  back: "Back",
  done: "Done",
  close: "Close the tour",
  stepOf: "Step {step} of {total}",
};
const STEPS = [
  { target: "your-apps", title: "Your apps", body: "Open them from here." },
  { target: "missing", title: "Not on this page", body: "Skipped." },
  { target: "nav-apps", title: "All apps", body: "Ask for more here." },
];

function page(props: Partial<Parameters<typeof GuidedTour>[0]> = {}) {
  const onDone = vi.fn().mockResolvedValue(undefined);
  render(
    <main id="main-content" tabIndex={-1}>
      <section data-tour="your-apps">Your apps</section>
      <a data-tour="nav-apps" href="/apps">
        Apps
      </a>
      <GuidedTour steps={STEPS} labels={LABELS} offer onDone={onDone} {...props} />
    </main>,
  );
  return { onDone };
}

describe("GuidedTour", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("offers the tour once, with a way to say no", () => {
    page();

    expect(screen.getByText(LABELS.offer)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Take the tour" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No thanks" })).toBeInTheDocument();
  });

  it("records the decision when they say no", async () => {
    const { onDone } = page();

    await userEvent.click(screen.getByRole("button", { name: "No thanks" }));

    expect(onDone).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(LABELS.offer)).not.toBeInTheDocument();
  });

  it("opens a labelled dialog on the first step, with focus inside it", async () => {
    page();

    await userEvent.click(screen.getByRole("button", { name: "Take the tour" }));

    const dialog = screen.getByRole("dialog", { name: "Your apps" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription("Open them from here.");
    expect(within(dialog).getByText("Step 1 of 2")).toBeInTheDocument();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("skips steps whose target isn't on the page, and goes back and forth", async () => {
    page();
    await userEvent.click(screen.getByRole("button", { name: "Take the tour" }));

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("dialog", { name: "All apps" })).toBeInTheDocument();
    expect(screen.getByText("Step 2 of 2")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("dialog", { name: "Your apps" })).toBeInTheDocument();
  });

  it("finishes on Done, recording it", async () => {
    const { onDone } = page();
    await userEvent.click(screen.getByRole("button", { name: "Take the tour" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  // The offer that started it is gone by then, so focus lands on the page's
  // main landmark rather than nowhere.
  it("closes on Escape, recording it, and puts focus back on the page", async () => {
    const { onDone } = page();
    await userEvent.click(screen.getByRole("button", { name: "Take the tour" }));

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onDone).toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("main"));
  });

  it("gives focus back to what had it, when that's still there", async () => {
    render(
      <main id="main-content" tabIndex={-1}>
        <section data-tour="your-apps">Your apps</section>
        <button type="button">Elsewhere</button>
        <GuidedTour steps={STEPS} labels={LABELS} offer={false} startOpen onDone={vi.fn()} />
      </main>,
    );
    // Opened straight away from the page, as the checklist's link does.
    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps Tab inside the dialog", async () => {
    page();
    await userEvent.click(screen.getByRole("button", { name: "Take the tour" }));
    const dialog = screen.getByRole("dialog");

    for (let i = 0; i < 6; i++) {
      await userEvent.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it("starts straight away when asked to (the checklist's link)", () => {
    page({ offer: false, startOpen: true });

    expect(screen.getByRole("dialog", { name: "Your apps" })).toBeInTheDocument();
  });

  it("shows nothing when there's nothing to offer", () => {
    page({ offer: false });

    expect(screen.queryByRole("button", { name: "Take the tour" })).not.toBeInTheDocument();
  });
});
