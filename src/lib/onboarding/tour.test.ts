import { describe, it, expect } from "vitest";
import { TOUR_STEPS, TOUR_VERSION, stepsFor } from "./tour";

// #21: bumping TOUR_VERSION after a UI change shows returning people only
// the steps that are new to them.
describe("stepsFor", () => {
  it("shows everything to someone who's never taken the tour", () => {
    expect(stepsFor(null)).toEqual(TOUR_STEPS);
  });

  it("shows nothing to someone who's seen the current tour", () => {
    expect(stepsFor(TOUR_VERSION)).toEqual([]);
  });

  it("shows only steps added since the version they saw", () => {
    const steps = [
      { id: "a", target: "a", since: 1 },
      { id: "b", target: "b", since: 2 },
    ];

    expect(stepsFor(1, steps).map((s) => s.id)).toEqual(["b"]);
  });

  it("points every step at something the dashboard marks with data-tour", () => {
    for (const step of TOUR_STEPS) expect(step.target).toMatch(/^[a-z-]+$/);
    expect(TOUR_STEPS.every((step) => step.since <= TOUR_VERSION)).toBe(true);
  });
});
