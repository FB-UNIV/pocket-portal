// Which of an app's groups the request form preselects. PocketID groups
// carry no notion of "level", so this reads their names: the everyday
// role ("users", "Jellyfin users", "members") rather than an elevated one
// ("admins", "Jellyfin admins"), so the default ask is the least-privileged
// one and asking for more is a deliberate choice.
//
// Order of preference:
// 1. a name that says user or member and not admin;
// 2. any name that doesn't say admin;
// 3. the first group, as PocketID lists them.

interface Role {
  id: string;
  name: string;
  friendlyName: string;
}

const EVERYDAY = /\b(users?|members?)\b/i;
const ELEVATED = /\b(admins?|administrators?|owners?|ops)\b/i;

// Splits on separators PocketID names commonly use, so "jellyfin-users"
// and "jellyfin_admins" read as words.
function words(role: Role): string {
  return `${role.name} ${role.friendlyName}`.replace(/[-_.]/g, " ");
}

export function defaultRole<T extends Role>(roles: readonly T[]): T | undefined {
  const everyday = roles.filter((r) => !ELEVATED.test(words(r)));
  return everyday.find((r) => EVERYDAY.test(words(r))) ?? everyday[0] ?? roles[0];
}
