import { describe, it, expect, vi, afterEach } from "vitest";
import { SpanStatusCode, TraceFlags, trace } from "@opentelemetry/api";
import { withSpan, traceFields } from "./tracing";
import { recordSpans } from "@/test/otel";

afterEach(() => vi.restoreAllMocks());

describe("withSpan", () => {
  it("wraps the work in a named span with its attributes, and ends it", async () => {
    const spans = recordSpans();

    const result = await withSpan("catalog.build", { "portal.catalog.view": "user" }, async () => 42);

    expect(result).toBe(42);
    expect(spans).toEqual([
      expect.objectContaining({
        name: "catalog.build",
        attributes: { "portal.catalog.view": "user" },
        ended: true,
      }),
    ]);
  });

  it("lets the work add attributes it only knows at the end", async () => {
    const spans = recordSpans();

    await withSpan("catalog.build", {}, async (span) => {
      span.setAttribute("portal.catalog.apps", 3);
    });

    expect(spans[0].attributes).toEqual({ "portal.catalog.apps": 3 });
  });

  it("marks the span failed, records the error, ends it, and rethrows", async () => {
    const spans = recordSpans();
    const err = new Error("PocketID timed out");

    await expect(
      withSpan("access_request.grant", {}, async () => {
        throw err;
      }),
    ).rejects.toBe(err);

    expect(spans[0]).toMatchObject({
      status: { code: SpanStatusCode.ERROR },
      exceptions: [err],
      ended: true,
    });
  });
});

describe("withSpan without error details", () => {
  // For work whose errors can quote personal data (SMTP refusals quote the
  // address, database errors the value): the type, never the message.
  it("records only the error's type", async () => {
    const spans = recordSpans();
    const err = Object.assign(new Error("550 <alice@example.test> refused"), { code: "EENVELOPE" });

    await expect(
      withSpan(
        "email.send",
        {},
        async () => {
          throw err;
        },
        { errorDetail: "type" },
      ),
    ).rejects.toBe(err);

    expect(spans[0]).toMatchObject({
      status: { code: SpanStatusCode.ERROR },
      attributes: { "error.type": "EENVELOPE" },
      exceptions: [],
      ended: true,
    });
    expect(JSON.stringify(spans)).not.toContain("alice@example.test");
  });
});

describe("traceFields", () => {
  const span = (traceId: string, spanId: string) =>
    trace.wrapSpanContext({ traceId, spanId, traceFlags: TraceFlags.SAMPLED });

  it("gives a log line the ids of the span it was written in", () => {
    expect(traceFields(span("4bf92f3577b34da6a3ce929d0e0e4736", "00f067aa0ba902b7"))).toEqual({
      trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
      span_id: "00f067aa0ba902b7",
    });
  });

  it("adds nothing outside a span, or for an invalid one", () => {
    expect(traceFields(undefined)).toEqual({});
    expect(traceFields(span("0".repeat(32), "0".repeat(16)))).toEqual({});
  });

  it("reads the active span by default", () => {
    vi.spyOn(trace, "getActiveSpan").mockReturnValue(span("4bf92f3577b34da6a3ce929d0e0e4736", "00f067aa0ba902b7"));

    expect(traceFields()).toEqual({
      trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
      span_id: "00f067aa0ba902b7",
    });
  });
});
