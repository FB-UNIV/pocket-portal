// The guided tour of the dashboard (#21 phase 2): a few steps, each pointing
// at something the page marks with `data-tour="<target>"`. A step whose
// target isn't on the page (no checklist left, say) is skipped.
//
// Bump TOUR_VERSION when the dashboard changes enough to show people again,
// and give the new steps `since: <new version>`: returning people see only
// those, newcomers see them all.

export const TOUR_VERSION = 1;

export interface TourStep {
  // Its words, in the "Tour" messages: `<id>Title` and `<id>Body`.
  id: string;
  target: string;
  since: number;
}

export const TOUR_STEPS: TourStep[] = [
  { id: "yourApps", target: "your-apps", since: 1 },
  { id: "allApps", target: "nav-apps", since: 1 },
  { id: "welcome", target: "welcome", since: 1 },
  { id: "account", target: "account", since: 1 },
];

// The steps someone hasn't seen: all of them if they never took the tour.
export function stepsFor(seenVersion: number | null, steps: TourStep[] = TOUR_STEPS): TourStep[] {
  return steps.filter((step) => step.since > (seenVersion ?? 0));
}
