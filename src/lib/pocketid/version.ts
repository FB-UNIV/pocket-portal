import { logger as defaultLogger } from "@/lib/observability/logger";
import { configSource, type ConfigSource } from "@/lib/config";

type Log = Pick<typeof defaultLogger, "error" | "info">;

// The oldest PocketID the portal works with: 2.15.0 is the first whose
// OIDC client list carries each client's allowedUserGroups
// (pocket-id/pocket-id#1671); before, it had only a count.
export const MIN_POCKETID_VERSION = "2.15.0";

const TIMEOUT_MS = 2_000;

function parse(version: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

// Null when the version can't be parsed.
export function meetsMinimumVersion(version: string): boolean | null {
  const actual = parse(version);
  const minimum = parse(MIN_POCKETID_VERSION)!;
  if (!actual) return null;
  for (let i = 0; i < 3; i++) {
    if (actual[i] !== minimum[i]) return actual[i] > minimum[i];
  }
  return true;
}

export async function getPocketIdVersion(
  baseUrl: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/api/version/current`, {
      headers: { "X-API-KEY": apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const version = (body as { currentVersion?: unknown } | null)?.currentVersion;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

// At startup, so an old PocketID is named in the logs before a page fails.
export async function warnIfPocketIdTooOld(
  env: ConfigSource = configSource(),
  log: Log = defaultLogger,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!env.POCKETID_BASE_URL || !env.POCKETID_API_KEY) return;

  const version = await getPocketIdVersion(env.POCKETID_BASE_URL, env.POCKETID_API_KEY, fetchImpl);
  const ok = version === null ? null : meetsMinimumVersion(version);

  if (ok === false) {
    log.error(
      `PocketID ${version} is too old: the portal needs PocketID ${MIN_POCKETID_VERSION} or later. ` +
        "Upgrade PocketID; until then the app list and access requests fail.",
    );
  } else if (ok === null) {
    log.info(`Could not read PocketID's version; the portal needs ${MIN_POCKETID_VERSION} or later.`);
  }
}
