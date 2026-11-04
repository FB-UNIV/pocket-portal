import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { findVulnerabilities, main, renderAnnotations, renderSummary } from "./audit-report.mjs";

const audit = {
  vulnerabilities: {
    next: {
      name: "next",
      severity: "critical",
      isDirect: true,
      range: "16.0.0 - 16.3.7",
      via: [{ title: "RCE in next/og", url: "https://github.com/advisories/GHSA-1" }],
      fixAvailable: { name: "next", version: "16.4.3", isSemVerMajor: false },
    },
    sharp: {
      name: "sharp",
      severity: "high",
      isDirect: false,
      range: "<0.35.5",
      via: [{ title: "librsvg CVE", url: "https://github.com/advisories/GHSA-2" }],
      fixAvailable: true,
    },
    "@auth/core": {
      name: "@auth/core",
      severity: "moderate",
      isDirect: false,
      range: "*",
      via: ["nodemailer"],
      fixAvailable: { name: "next-auth", version: "1.12.1", isSemVerMajor: true },
    },
  },
};

function run(args, json = audit) {
  const dir = mkdtempSync(path.join(tmpdir(), "audit-"));
  const file = path.join(dir, "audit.json");
  const summary = path.join(dir, "summary.md");
  writeFileSync(file, JSON.stringify(json));
  writeFileSync(summary, "");
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const code = main([file, ...args], { GITHUB_STEP_SUMMARY: summary });
  const out = log.mock.calls.map((c) => c[0]).join("\n");
  log.mockRestore();
  return { code, out, summary: readFileSync(summary, "utf8") };
}

describe("findVulnerabilities", () => {
  it("keeps the given level and worse, most severe first", () => {
    expect(findVulnerabilities(audit, "high").map((v) => v.name)).toEqual(["next", "sharp"]);
    expect(findVulnerabilities(audit, "moderate")).toHaveLength(3);
    expect(findVulnerabilities({}, "low")).toEqual([]);
  });
});

describe("renderSummary", () => {
  it("names each package, its advisory and the fix", () => {
    const md = renderSummary(findVulnerabilities(audit, "moderate"), { title: "Prod", level: "moderate" });
    expect(md).toContain("### Prod: 3 package(s) at moderate or worse");
    expect(md).toContain("| `next` | critical | 16.0.0 - 16.3.7 | [RCE in next/og](https://github.com/advisories/GHSA-1) | next@16.4.3 |");
    expect(md).toContain("| `sharp` (transitive) | high | <0.35.5 |");
    expect(md).toContain("`npm audit fix`");
    expect(md).toContain("via nodemailer");
    expect(md).toContain("next-auth@1.12.1 (major: needs `--force`)");
  });

  it("says when there is nothing to report", () => {
    expect(renderSummary([], { title: "Prod", level: "high" })).toBe("### Prod: no high or worse vulnerabilities\n");
  });
});

describe("renderAnnotations", () => {
  it("emits one escaped workflow command per package", () => {
    const [line] = renderAnnotations(
      [{ ...audit.vulnerabilities.next, via: [{ title: "100% bad\nreally", url: "u" }] }],
      { mode: "warning", title: "Prod" },
    );
    expect(line).toBe("::warning title=Prod: next (critical)::100%25 bad%0Areally. Fix: next@16.4.3");
  });

  it("falls back to the dependency chain when there is no advisory", () => {
    const [line] = renderAnnotations([{ ...audit.vulnerabilities["@auth/core"], fixAvailable: false }], {
      mode: "error",
      title: "All",
    });
    expect(line).toBe("::error title=All: @auth/core (moderate)::via nodemailer. Fix: none yet");
  });
});

describe("main", () => {
  it("fails in error mode and writes the job summary", () => {
    const { code, out, summary } = run(["--level", "high", "--mode", "error", "--title", "Prod"]);
    expect(code).toBe(1);
    expect(summary).toContain("2 package(s) at high or worse");
    expect(out).toContain("::error title=Prod: next (critical)::");
  });

  it("never fails in warning mode", () => {
    const { code, out } = run(["--level", "moderate", "--mode", "warning"]);
    expect(code).toBe(0);
    expect(out).toContain("::warning title=Dependency audit: sharp (high)::");
  });

  it("passes when nothing reaches the level", () => {
    expect(run(["--level", "critical"], { vulnerabilities: {} }).code).toBe(0);
  });

  it("reports an npm audit error instead of a clean result", () => {
    const { code, out } = run([], { error: { summary: "registry unreachable" } });
    expect(code).toBe(1);
    expect(out).toContain("npm audit failed::registry unreachable");
  });

  it("rejects bad arguments", () => {
    expect(() => main([])).toThrow(/usage/);
    expect(() => main(["x.json", "--mode", "loud"])).toThrow(/usage/);
  });
});
