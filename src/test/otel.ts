import { vi } from "vitest";
import { trace, type Attributes, type SpanStatus, type Tracer } from "@opentelemetry/api";

export interface RecordedSpan {
  name: string;
  attributes: Attributes;
  status?: SpanStatus;
  exceptions: unknown[];
  ended: boolean;
}

// Records the spans the portal's own code starts, without registering a
// global OpenTelemetry provider (which can only be set once per process):
// trace.getTracer is stubbed to hand back a tracer that keeps what it saw.
// Call in a test or beforeEach; vi.restoreAllMocks() undoes it.
export function recordSpans(): RecordedSpan[] {
  const spans: RecordedSpan[] = [];

  const start = (name: string, options?: { attributes?: Attributes }) => {
    const recorded: RecordedSpan = {
      name,
      attributes: { ...options?.attributes },
      exceptions: [],
      ended: false,
    };
    spans.push(recorded);
    const span = {
      setAttribute(key: string, value: unknown) {
        recorded.attributes[key] = value as Attributes[string];
        return span;
      },
      setAttributes(attributes: Attributes) {
        Object.assign(recorded.attributes, attributes);
        return span;
      },
      setStatus(status: SpanStatus) {
        recorded.status = status;
        return span;
      },
      recordException(exception: unknown) {
        recorded.exceptions.push(exception);
      },
      end() {
        recorded.ended = true;
      },
      isRecording: () => true,
      spanContext: () => ({ traceId: "0".repeat(32), spanId: "0".repeat(16), traceFlags: 1 }),
    };
    return span;
  };

  const tracer = {
    startSpan: start,
    startActiveSpan(name: string, ...rest: unknown[]) {
      const fn = rest.at(-1) as (span: unknown) => unknown;
      const options = rest.length > 1 ? (rest[0] as { attributes?: Attributes }) : undefined;
      return fn(start(name, options));
    },
  } as unknown as Tracer;

  vi.spyOn(trace, "getTracer").mockReturnValue(tracer);
  return spans;
}
