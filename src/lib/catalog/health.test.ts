import { describe, it, expect } from "vitest";
import { appProblems } from "./health";

describe("appProblems", () => {
  it("finds nothing wrong with a described app that has a link", () => {
    expect(appProblems({ launchUrl: "https://x.example.test", description: "Watch films" })).toEqual([]);
  });

  it("flags a missing link and a blank description", () => {
    expect(appProblems({ launchUrl: null, description: "  " })).toEqual(["no-link", "no-description"]);
  });
});
