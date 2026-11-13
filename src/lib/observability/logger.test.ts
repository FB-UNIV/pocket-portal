import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TraceFlags, trace } from "@opentelemetry/api";
import { createLogger, formatPretty, syncLogLevel } from "./logger";

const ORIGINAL_ENV = { ...process.env };

describe("createLogger", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("binds the given name", () => {
    const log = createLogger("test-service");
    expect(log.bindings().name).toBe("test-service");
  });

  it("defaults to info level when LOG_LEVEL is unset", () => {
    delete process.env.LOG_LEVEL;
    const log = createLogger("test-service");
    expect(log.level).toBe("info");
  });

  // pino itself would throw, and every module that logs would fail to import.
  it("falls back to info on an unknown LOG_LEVEL", () => {
    process.env.LOG_LEVEL = "verbose";
    const log = createLogger("test-service");
    expect(log.level).toBe("info");
  });

  it("re-reads the level once the config file has set it", () => {
    const log = createLogger("test-service");
    process.env.LOG_LEVEL = "warn";

    syncLogLevel(log);

    expect(log.level).toBe("warn");
  });

  it("respects the LOG_LEVEL environment variable", () => {
    process.env.LOG_LEVEL = "debug";
    const log = createLogger("test-service");
    expect(log.level).toBe("debug");
  });
});

// Collects what the logger writes, one parsed or raw line per entry.
function capture() {
  const lines: string[] = [];
  return { lines, stream: { write: (line: string) => void lines.push(line) } };
}

describe("log format", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("writes JSON with level names and ISO timestamps by default", () => {
    delete process.env.LOG_FORMAT;
    const { lines, stream } = capture();

    createLogger("test-service", stream).error({ route: "/apps" }, "boom");

    const entry = JSON.parse(lines[0]);
    expect(entry).toMatchObject({ level: "error", name: "test-service", msg: "boom", route: "/apps" });
    expect(entry.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("writes one readable line per entry with LOG_FORMAT=pretty", () => {
    process.env.LOG_FORMAT = "pretty";
    const { lines, stream } = capture();

    createLogger("test-service", stream).info({ route: "/apps", status: 200 }, "GET /apps 200 29ms");

    // route and status are already in the message, so they aren't repeated.
    expect(lines[0]).toMatch(/^\S+Z INFO  test-service: GET \/apps 200 29ms\n$/);
  });
});

// Log <-> trace correlation (#16): a line written during a request carries
// that request's trace, so Loki and Tempo can link the two both ways.
describe("trace ids on log lines", () => {
  afterEach(() => vi.restoreAllMocks());

  it("adds trace_id and span_id inside a span", () => {
    vi.spyOn(trace, "getActiveSpan").mockReturnValue(
      trace.wrapSpanContext({
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        spanId: "00f067aa0ba902b7",
        traceFlags: TraceFlags.SAMPLED,
      }),
    );
    const { lines, stream } = capture();

    createLogger("test-service", stream).info("inside a request");

    expect(JSON.parse(lines[0])).toMatchObject({
      trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
      span_id: "00f067aa0ba902b7",
    });
  });

  it("adds neither outside a span", () => {
    vi.spyOn(trace, "getActiveSpan").mockReturnValue(undefined);
    const { lines, stream } = capture();

    createLogger("test-service", stream).info("at startup");

    const entry = JSON.parse(lines[0]);
    expect(entry).not.toHaveProperty("trace_id");
    expect(entry).not.toHaveProperty("span_id");
  });
});

// Defence in depth (#4): nothing should log a credential, but if a config
// or a headers object ever ends up in a log call, the secret doesn't.
describe("redaction", () => {
  it.each([
    [{ apiKey: "pocketid-key" }, "apiKey"],
    [{ config: { apiKey: "pocketid-key" } }, "config.apiKey"],
    [{ headers: { "x-api-key": "pocketid-key" } }, "headers.x-api-key"],
    [{ headers: { authorization: "Bearer pocketid-key" } }, "headers.authorization"],
    [{ headers: { cookie: "authjs.session-token=pocketid-key" } }, "headers.cookie"],
    [{ smtp: { auth: { pass: "pocketid-key" } } }, "smtp.auth.pass"],
    [{ clientSecret: "pocketid-key" }, "clientSecret"],
    [{ password: "pocketid-key" }, "password"],
  ])("never writes %j", (fields, _where) => {
    const { lines, stream } = capture();

    createLogger("test-service", stream).info(fields, "something happened");

    expect(lines[0]).not.toContain("pocketid-key");
    expect(lines[0]).toContain("[redacted]");
  });
});

describe("formatPretty", () => {
  it("puts an error's stack under the line", () => {
    const line = formatPretty({
      level: "error",
      time: "2026-09-26T10:00:00.000Z",
      name: "pocket-portal",
      msg: "GET /apps failed: boom",
      digest: "123",
      err: { type: "TypeError", message: "boom", stack: "TypeError: boom\n    at page (app/apps/page.tsx:1:1)" },
    });

    expect(line).toBe(
      "2026-09-26T10:00:00.000Z ERROR pocket-portal: GET /apps failed: boom digest=123\n" +
        "    TypeError: boom\n" +
        "        at page (app/apps/page.tsx:1:1)\n",
    );
  });

  it("quotes values with spaces and prints objects as JSON", () => {
    const line = formatPretty({
      level: "warn",
      time: "2026-09-26T10:00:00.000Z",
      msg: "m",
      reason: "two words",
      detail: { a: 1 },
      attempts: 3,
      retried: false,
    });

    expect(line).toBe(
      '2026-09-26T10:00:00.000Z WARN  m reason="two words" detail={"a":1} attempts=3 retried=false\n',
    );
  });
});

describe("log format edge cases", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  // validateConfig reports the bad value; logging must keep working.
  it("falls back to JSON on an unknown LOG_FORMAT", () => {
    process.env.LOG_FORMAT = "fancy";
    const { lines, stream } = capture();

    createLogger("test-service", stream).info("hello");

    expect(JSON.parse(lines[0])).toMatchObject({ msg: "hello" });
  });

  it("writes to stdout without a stream", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    createLogger("test-service").info("to stdout");

    expect(write.mock.calls.some(([chunk]) => String(chunk).includes("to stdout"))).toBe(true);
  });

  it("formats an error without a stack, and an entry without a message", () => {
    expect(formatPretty({ level: "error", time: "t", err: { type: "RangeError", message: "bad" } })).toBe(
      "t ERROR \n    RangeError: bad\n",
    );
    expect(formatPretty({ time: "t", err: {} })).toBe("t       \n    Error: \n");
  });
});

describe("formatPretty de-duplication", () => {
  it("leaves out fields the message already shows, and keeps the rest", () => {
    const line = formatPretty({
      level: "info",
      time: "t",
      msg: "GET /nope 404 9ms",
      method: "GET",
      path: "/nope",
      route: "/_not-found",
      status: 404,
      durationMs: 9,
    });

    expect(line).toBe("t INFO  GET /nope 404 9ms route=/_not-found\n");
  });
});
