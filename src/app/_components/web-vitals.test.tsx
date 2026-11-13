import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { useReportWebVitals } from "next/web-vitals";
import { WebVitals } from "./web-vitals";

vi.mock("next/web-vitals", () => ({ useReportWebVitals: vi.fn() }));

type Report = Parameters<typeof useReportWebVitals>[0];
type Metric = Parameters<Report>[0];

function reporter(): Report {
  render(<WebVitals />);
  return vi.mocked(useReportWebVitals).mock.calls.at(-1)![0];
}

const metric = (overrides: Partial<Metric>) =>
  ({ name: "LCP", value: 1234.5, id: "v1", delta: 0, rating: "good", navigationType: "navigate", entries: [], ...overrides }) as Metric;

describe("WebVitals", () => {
  const sendBeacon = vi.fn(() => true);

  beforeEach(() => {
    sendBeacon.mockClear();
    vi.mocked(useReportWebVitals).mockClear();
    Object.defineProperty(navigator, "sendBeacon", { value: sendBeacon, configurable: true });
    window.history.replaceState(null, "", "/apps?q=photos");
  });

  it("beacons time to first byte, largest paint and interaction delay, with the page's path", async () => {
    const report = reporter();

    report(metric({ name: "LCP", value: 1234.5 }));

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const [url, body] = sendBeacon.mock.calls[0] as unknown as [string, Blob];
    expect(url).toBe("/api/web-vitals");
    expect(body.type).toBe("application/json");
    // Path only: a query string can carry a search term.
    expect(JSON.parse(await body.text())).toEqual({ name: "LCP", value: 1234.5, path: "/apps" });
  });

  // A vital measured on one page can be reported after a client-side
  // navigation to the next: it belongs to the page it measured.
  it("credits the page the vital was measured on", async () => {
    const report = reporter();

    report(metric({ name: "INP", value: 80, navigationURL: "https://portal.example.test/admin/requests?x=1" } as Partial<Metric>));

    const [, body] = sendBeacon.mock.calls[0] as unknown as [string, Blob];
    expect(JSON.parse(await body.text())).toMatchObject({ name: "INP", path: "/admin/requests" });
  });

  it("sends nothing for the vitals the portal doesn't record", () => {
    const report = reporter();

    report(metric({ name: "CLS", value: 0.02 }));
    report(metric({ name: "FCP", value: 300 }));

    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("renders nothing", () => {
    const { container } = render(<WebVitals />);

    expect(container).toBeEmptyDOMElement();
  });
});
