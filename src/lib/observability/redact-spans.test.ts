import { describe, it, expect } from "vitest";
import { QueryRedactionProcessor, withoutQuery } from "./redact-spans";

// A span as onEnding sees it: still writable, attributes all set.
function span(attributes: Record<string, unknown>) {
  return {
    attributes: { ...attributes },
    setAttribute(key: string, value: unknown) {
      this.attributes[key] = value;
      return this;
    },
  };
}

describe("QueryRedactionProcessor", () => {
  // Next's request span carries the full target, and on the OIDC callback
  // that's the sign-in code and state: never export them.
  it("drops the query string from the request target before export", () => {
    const s = span({
      "http.method": "GET",
      "http.target": "/api/auth/callback/pocketid?code=SECRET&state=ALSO&iss=x",
      "http.route": "/api/auth/[...nextauth]",
    });

    new QueryRedactionProcessor().onEnding(s as never);

    expect(s.attributes["http.target"]).toBe("/api/auth/callback/pocketid");
    expect(JSON.stringify(s.attributes)).not.toMatch(/SECRET|ALSO/);
  });

  it("does the same for full URLs, and blanks a separate query attribute", () => {
    const s = span({
      "http.url": "https://id.example.test/api/users?pagination%5Bpage%5D=1",
      "url.full": "https://portal.example.test/apps?q=salary",
      "url.query": "q=salary",
    });

    new QueryRedactionProcessor().onEnding(s as never);

    expect(s.attributes).toEqual({
      "http.url": "https://id.example.test/api/users",
      "url.full": "https://portal.example.test/apps",
      "url.query": "[redacted]",
    });
  });

  it("leaves everything else alone", () => {
    const s = span({ "http.target": "/apps", "http.status_code": 200, "db.query.text": "select $1" });

    new QueryRedactionProcessor().onEnding(s as never);

    expect(s.attributes).toEqual({ "http.target": "/apps", "http.status_code": 200, "db.query.text": "select $1" });
  });

  it("has nothing else to do", async () => {
    const processor = new QueryRedactionProcessor();
    processor.onStart();
    processor.onEnd();
    await expect(processor.forceFlush()).resolves.toBeUndefined();
    await expect(processor.shutdown()).resolves.toBeUndefined();
  });
});

describe("withoutQuery", () => {
  it.each([
    ["/a?b=c", "/a"],
    ["/a", "/a"],
    ["https://x.test/a?b#c", "https://x.test/a"],
    ["?only", ""],
  ])("%s is %s", (input, output) => {
    expect(withoutQuery(input)).toBe(output);
  });
});
