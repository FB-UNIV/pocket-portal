import { describe, it, expect } from "vitest";
import { formatUtcTimestamp, utcDayParts } from "./utc-timestamp";

describe("formatUtcTimestamp", () => {
  it("formats in UTC with a fixed English month, whatever the host TZ", () => {
    expect(formatUtcTimestamp(new Date("2026-09-21T10:00:00Z"))).toBe("21 Sep 2026, 10:00 UTC");
  });

  it("zero-pads day, hour and minute", () => {
    expect(formatUtcTimestamp(new Date("2026-01-05T03:07:00Z"))).toBe("05 Jan 2026, 03:07 UTC");
  });

  it("spells the month in French for a French page", () => {
    expect(formatUtcTimestamp(new Date("2026-09-21T10:00:00Z"), "fr")).toBe("21 sept. 2026, 10:00 UTC");
    expect(formatUtcTimestamp(new Date("2026-08-05T03:07:00Z"), "fr")).toBe("05 août 2026, 03:07 UTC");
  });
});

// The admin queue says "today, 08:15" rather than a full date for recent
// requests. Days are UTC days, like every timestamp here.
describe("utcDayParts", () => {
  const now = new Date("2026-11-10T09:00:00Z");

  it("calls a time earlier the same UTC day today", () => {
    expect(utcDayParts(new Date("2026-11-10T08:15:00Z"), now)).toEqual({
      day: "today",
      date: "10 Nov 2026",
      time: "08:15",
    });
  });

  it("calls the UTC day before yesterday, even under 24 hours ago", () => {
    expect(utcDayParts(new Date("2026-11-09T18:42:00Z"), now).day).toBe("yesterday");
    expect(utcDayParts(new Date("2026-11-09T00:00:00Z"), now).day).toBe("yesterday");
  });

  it("gives the date for anything older, in the page's language", () => {
    expect(utcDayParts(new Date("2026-11-08T23:59:00Z"), now)).toEqual({
      day: "other",
      date: "08 Nov 2026",
      time: "23:59",
    });
    expect(utcDayParts(new Date("2026-09-21T10:00:00Z"), now, "fr").date).toBe("21 sept. 2026");
  });
});
