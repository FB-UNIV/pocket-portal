import { logger as defaultLogger } from "@/lib/observability/logger";
import { configSource, type ConfigSource } from "@/lib/config";

type Log = Pick<typeof defaultLogger, "warn" | "info">;

export type SecretExposure = "masked" | "readable" | "unknown";

const TIMEOUT_MS = 2_000;

// PocketID masks smtpPassword/ldapBindPassword from its admin API only when
// UI_CONFIG_DISABLED=true. Its public, unauthenticated config endpoint
// reports that flag, so we check it without sending the API key or pulling
// the secrets themselves.
export async function getSecretExposure(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SecretExposure> {
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/api/application-configuration`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return "unknown";

    const body: unknown = await res.json();
    if (!Array.isArray(body)) return "unknown";

    const flag = body.find((v) => v?.key === "uiConfigDisabled")?.value;
    if (flag === "true") return "masked";
    if (flag === "false") return "readable";
    return "unknown";
  } catch {
    return "unknown";
  }
}

export async function warnIfPocketIdSecretsReadable(
  env: ConfigSource = configSource(),
  log: Log = defaultLogger,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!env.POCKETID_BASE_URL) return;

  const exposure = await getSecretExposure(env.POCKETID_BASE_URL, fetchImpl);

  if (exposure === "readable") {
    log.warn(
      "PocketID exposes its SMTP/LDAP passwords to this portal's API key. " +
        "Set UI_CONFIG_DISABLED=true on PocketID. See README 'Securing the portal'.",
    );
  } else if (exposure === "unknown") {
    log.info("Could not check PocketID's UI_CONFIG_DISABLED setting; skipping secret-exposure check.");
  }
}
