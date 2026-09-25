import { describe, it, expect } from "vitest";
import { safeLaunchUrl } from "./launch-url";

describe("safeLaunchUrl", () => {
  it.each(["https://app.example.com", "http://app.example.com:8080/path?q=1"])(
    "keeps the http(s) URL %j",
    (url) => {
      expect(safeLaunchUrl(url)).toBe(url);
    },
  );

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "  javascript:alert(1)",
    "\njavascript:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "//app.example.com",
    "not a url",
    "",
  ])("rejects %j", (url) => {
    expect(safeLaunchUrl(url)).toBeNull();
  });

  it("passes a missing launch URL through as null", () => {
    expect(safeLaunchUrl(null)).toBeNull();
  });
});
