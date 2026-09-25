import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// .env.example is what compose deployers copy; a stale pin there has them
// install an old release by default.
describe(".env.example", () => {
  it("pins the current release", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const tag = /^POCKET_PORTAL_TAG=(.*)$/m.exec(readFileSync(".env.example", "utf8"))?.[1];

    expect(tag).toBe(`v${pkg.version}`);
  });
});
