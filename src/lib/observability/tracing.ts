import {
  SpanStatusCode,
  isSpanContextValid,
  trace,
  type Attributes,
  type Span,
} from "@opentelemetry/api";

// The portal's own spans (#16): the steps Next.js and fetch instrumentation
// can't see, such as building the catalog, deciding a request, the grant,
// database queries and email sends. They nest under the request's span, so
// a slow page shows which step was slow.
const TRACER_NAME = "pocket-portal";

export function tracer() {
  return trace.getTracer(TRACER_NAME);
}

// The type of an error, never its message: what's safe to put on a span
// whose errors can quote personal data. A Node or driver error code
// (`EENVELOPE`, Postgres' `23505`) when there is one, else the class name.
export function errorType(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string" && code) return code;
  return err instanceof Error ? err.name : typeof err;
}

export interface SpanOptions {
  /**
   * "message" (default) records the exception and its message on the span.
   * "type" records only errorType(): for work whose errors can quote
   * personal data, such as an SMTP refusal quoting the address.
   */
  errorDetail?: "message" | "type";
}

// Marks a span failed, in as much detail as the caller allows.
export function failSpan(span: Span, err: unknown, errorDetail: SpanOptions["errorDetail"] = "message") {
  if (errorDetail === "type") {
    span.setAttribute("error.type", errorType(err));
    span.setStatus({ code: SpanStatusCode.ERROR });
    return;
  }
  span.recordException(err instanceof Error ? err : String(err));
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: err instanceof Error ? err.message : String(err),
  });
}

// Runs `work` inside a named span, active so anything it calls nests under
// it. Ends the span whatever happens; a failure marks it and is rethrown.
// With no tracing SDK registered (tests, or OTel off) this is a no-op span.
export function withSpan<T>(
  name: string,
  attributes: Attributes,
  work: (span: Span) => Promise<T>,
  { errorDetail }: SpanOptions = {},
): Promise<T> {
  return tracer().startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await work(span);
    } catch (err) {
      failSpan(span, err, errorDetail);
      throw err;
    } finally {
      span.end();
    }
  });
}

// trace_id and span_id of a span, for a log line, so a line leads to its
// trace and back (Loki derived fields, Tempo's "traces to logs"). Nothing
// outside a span, or for an invalid (all-zero) one.
export function traceFields(span: Span | undefined = trace.getActiveSpan()): {
  trace_id?: string;
  span_id?: string;
} {
  const context = span?.spanContext();
  if (!context || !isSpanContextValid(context)) return {};
  return { trace_id: context.traceId, span_id: context.spanId };
}
