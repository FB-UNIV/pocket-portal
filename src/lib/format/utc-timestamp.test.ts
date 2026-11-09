import { describe, it, expect } from "vitest";
import { formatUtcTimestamp } from "./utc-timestamp";

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
