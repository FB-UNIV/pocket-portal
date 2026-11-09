import { describe, it, expect } from "vitest";
import { defaultRole } from "./default-role";

const role = (name: string, friendlyName = name) => ({ id: name, name, friendlyName });

describe("defaultRole", () => {
  it("prefers the users group over the admins one, in either order", () => {
    expect(defaultRole([role("jellyfin-admins"), role("jellyfin-users")])?.id).toBe("jellyfin-users");
    expect(defaultRole([role("users"), role("admins")])?.id).toBe("users");
  });

  it("reads the friendly name too", () => {
    expect(defaultRole([role("g1", "Wiki Admins"), role("g2", "Wiki Members")])?.id).toBe("g2");
  });

  it("falls back to the first group that isn't an admin one", () => {
    expect(defaultRole([role("media_admin"), role("family"), role("friends")])?.id).toBe("family");
  });

  it("falls back to the first group when every one is elevated", () => {
    expect(defaultRole([role("admins"), role("owners")])?.id).toBe("admins");
  });

  it("matches whole words only: 'superusers' isn't a users group", () => {
    expect(defaultRole([role("superusers"), role("family-users")])?.id).toBe("family-users");
  });

  it("returns nothing for no groups", () => {
    expect(defaultRole([])).toBeUndefined();
  });
});
