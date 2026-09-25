import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Tables in the docs marked <!-- AUTO-GENERATED --> are checked against the
// files they describe, so they can't drift silently.
function generatedSection(path: string, heading: string): string {
  const doc = readFileSync(path, "utf8");
  const from = doc.indexOf("<!-- AUTO-GENERATED", doc.indexOf(heading));
  const to = doc.indexOf("<!-- /AUTO-GENERATED -->", from);
  expect(from, `${path}: no AUTO-GENERATED section under ${heading}`).toBeGreaterThan(-1);
  return doc.slice(doc.indexOf("-->", from) + 3, to);
}

describe("docs/DEVELOPMENT.md scripts table", () => {
  const scripts = Object.keys(JSON.parse(readFileSync("package.json", "utf8")).scripts);
  const table = generatedSection("docs/DEVELOPMENT.md", "### Scripts");
  const listed = [...table.matchAll(/^\| `npm (?:run )?([\w:-]+)`/gm)].map((m) => m[1]);

  it("lists every package.json script", () => {
    expect(scripts.filter((name) => !listed.includes(name))).toEqual([]);
  });

  it("lists nothing package.json doesn't define", () => {
    expect(listed.filter((name) => !scripts.includes(name))).toEqual([]);
  });
});
