import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createLogger, syncLogLevel } from "./logger";

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
