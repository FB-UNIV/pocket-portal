import { describe, it, expect, beforeEach, afterEach } from "vitest";
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

    expect(lines[0]).toMatch(/^\S+Z INFO  test-service: GET \/apps 200 29ms route=\/apps status=200\n$/);
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
    });

    expect(line).toBe('2026-09-26T10:00:00.000Z WARN  m reason="two words" detail={"a":1}\n');
  });
});
