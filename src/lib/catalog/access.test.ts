import { describe, it, expect } from "vitest";
import { hasAccessToClient } from "./access";

describe("hasAccessToClient", () => {
  it("grants access when the client is not group-restricted, regardless of the user's groups", () => {
    const client = { isGroupRestricted: false, allowedUserGroups: [] };

    expect(hasAccessToClient([], client)).toBe(true);
    expect(hasAccessToClient(["engineering"], client)).toBe(true);
  });

  it("grants access when a group-restricted client allows one of the user's groups", () => {
    const client = {
      isGroupRestricted: true,
      allowedUserGroups: [{ id: "g1", name: "engineering", friendlyName: "Engineering" }],
    };

    expect(hasAccessToClient(["engineering"], client)).toBe(true);
  });

  it("denies access when a group-restricted client allows none of the user's groups", () => {
    const client = {
      isGroupRestricted: true,
      allowedUserGroups: [{ id: "g1", name: "engineering", friendlyName: "Engineering" }],
    };

    expect(hasAccessToClient(["media"], client)).toBe(false);
  });

  it("denies access when the user belongs to no groups at all", () => {
    const client = {
      isGroupRestricted: true,
      allowedUserGroups: [{ id: "g1", name: "engineering", friendlyName: "Engineering" }],
    };

    expect(hasAccessToClient([], client)).toBe(false);
  });

  it("matches by group name, not friendlyName or id", () => {
    const client = {
      isGroupRestricted: true,
      allowedUserGroups: [{ id: "g1", name: "engineering", friendlyName: "Engineering Team" }],
    };

    expect(hasAccessToClient(["Engineering Team"], client)).toBe(false);
    expect(hasAccessToClient(["g1"], client)).toBe(false);
    expect(hasAccessToClient(["engineering"], client)).toBe(true);
  });
});
