// The portal's configuration in one place. Every setting is read
// through here rather than straight from process.env, so there is one list
// of what exists, one validation pass at startup, and one seam where a YAML
// file can later sit underneath the environment.
//
// Read on every call, never cached (.claude/rules/pocketid-api.md), and each
// reader fails on its own: a half-set SMTP config breaks email, not login.
//
// It deliberately imports nothing: the logger, the Edge-runtime half of
// instrumentation, and the mailer all read it, and none of them should drag
// in the others (nodemailer in an Edge bundle, say).

export type ConfigSource = Readonly<Record<string, string | undefined>>;

// The project's identifier: the default logger and trace service name.
const PROJECT_NAME = "pocket-portal";

// What the portal calls itself when neither the deployer nor PocketID
// names it.
export const DEFAULT_PORTAL_NAME = "Pocket Portal";

// Today just the environment, read live on every call. The YAML file
// would be merged in here underneath it, so env still wins and no reader
// changes.
export function configSource(): ConfigSource {
  return process.env;
}

export interface ConfigVar {
  name: string;
  required: boolean;
  // Never belongs in a config file: env only, or a *_FILE mount.
  secret: boolean;
  // Its key in the optional YAML file. Secrets have one too, only so
  // the loader can refuse them by name.
  yaml: string;
}

export const CONFIG_VARS: readonly ConfigVar[] = [
  { name: "POCKETID_BASE_URL", required: true, secret: false, yaml: "pocketid.baseUrl" },
  { name: "POCKETID_API_KEY", required: true, secret: true, yaml: "pocketid.apiKey" },
  { name: "POCKETID_OIDC_CLIENT_ID", required: true, secret: false, yaml: "pocketid.oidcClientId" },
  {
    name: "POCKETID_OIDC_CLIENT_SECRET",
    required: true,
    secret: true,
    yaml: "pocketid.oidcClientSecret",
  },
  { name: "AUTH_SECRET", required: true, secret: true, yaml: "auth.secret" },
  { name: "DATABASE_URL", required: true, secret: true, yaml: "database.url" },
  { name: "AUTH_URL", required: false, secret: false, yaml: "auth.url" },
  { name: "METRICS_TOKEN", required: false, secret: true, yaml: "metrics.token" },
  { name: "LOG_LEVEL", required: false, secret: false, yaml: "log.level" },
  { name: "OTEL_SERVICE_NAME", required: false, secret: false, yaml: "otel.serviceName" },
  { name: "PORTAL_NAME", required: false, secret: false, yaml: "branding.name" },
  { name: "SMTP_HOST", required: false, secret: false, yaml: "smtp.host" },
  { name: "SMTP_FROM", required: false, secret: false, yaml: "smtp.from" },
  { name: "SMTP_PORT", required: false, secret: false, yaml: "smtp.port" },
  { name: "SMTP_TLS", required: false, secret: false, yaml: "smtp.tls" },
  { name: "SMTP_USER", required: false, secret: false, yaml: "smtp.user" },
  { name: "SMTP_PASSWORD", required: false, secret: true, yaml: "smtp.password" },
  // Feature flags.
  { name: "FEATURE_ACCESS_REQUESTS", required: false, secret: false, yaml: "features.accessRequests" },
  {
    name: "ACCESS_REQUEST_REASON",
    required: false,
    secret: false,
    yaml: "features.accessRequestReason",
  },
  {
    name: "FEATURE_EMAIL_NOTIFICATIONS",
    required: false,
    secret: false,
    yaml: "features.emailNotifications",
  },
  {
    name: "FEATURE_POCKETID_BRANDING",
    required: false,
    secret: false,
    yaml: "features.pocketIdBranding",
  },
  { name: "FEATURE_AUDIT_LOG_PAGE", required: false, secret: false, yaml: "features.auditLogPage" },
  {
    name: "WARN_POCKETID_SECRETS_READABLE",
    required: false,
    secret: false,
    yaml: "features.secretsWarning",
  },
];

function required(source: ConfigSource, name: string): string {
  const value = source[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function optional(source: ConfigSource, name: string): string | undefined {
  return source[name] || undefined;
}

const trimSlashes = (url: string) => url.replace(/\/+$/, "");

export function readPocketIdApi(source: ConfigSource = configSource()) {
  return {
    baseUrl: trimSlashes(required(source, "POCKETID_BASE_URL")),
    apiKey: required(source, "POCKETID_API_KEY"),
  };
}

// PocketID OIDC client for portal login (ADR-0004).
export function readPocketIdOidc(source: ConfigSource = configSource()) {
  return {
    issuer: trimSlashes(required(source, "POCKETID_BASE_URL")),
    clientId: required(source, "POCKETID_OIDC_CLIENT_ID"),
    clientSecret: required(source, "POCKETID_OIDC_CLIENT_SECRET"),
  };
}

// For callers that degrade without PocketID (branding, the secrets banner)
// and must not throw.
export function readPocketIdBaseUrl(source: ConfigSource = configSource()): string | undefined {
  const url = optional(source, "POCKETID_BASE_URL");
  return url && trimSlashes(url);
}

export function readDatabaseUrl(source: ConfigSource = configSource()): string {
  return required(source, "DATABASE_URL");
}

export function readAuthUrl(source: ConfigSource = configSource()): string | undefined {
  const url = optional(source, "AUTH_URL");
  return url && trimSlashes(url);
}

export function readMetricsToken(source: ConfigSource = configSource()): string | undefined {
  return optional(source, "METRICS_TOKEN");
}

export function readOtelServiceName(source: ConfigSource = configSource()): string {
  return optional(source, "OTEL_SERVICE_NAME") ?? PROJECT_NAME;
}

// The name users see. Unset, the portal takes PocketID's (see
// lib/pocketid/branding.ts).
export function readPortalName(source: ConfigSource = configSource()): string | undefined {
  return optional(source, "PORTAL_NAME")?.trim() || undefined;
}

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export function readLogLevel(source: ConfigSource = configSource()): LogLevel {
  const level = optional(source, "LOG_LEVEL") ?? "info";
  if (!(LOG_LEVELS as readonly string[]).includes(level)) {
    throw new Error(`LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")}, not "${level}"`);
  }
  return level as LogLevel;
}

// The portal's own SMTP settings. Deliberately not PocketID's: it can't
// send on our behalf, and it redacts its password once UI_CONFIG_DISABLED is
// on (see ADR-0009 for the full reasoning).

// "starttls": plain connect, then upgrade, refusing to send if the server
// can't (port 587). "tls": TLS from the first byte (port 465). "none": no
// encryption, for a relay on a trusted network.
type SmtpTls = "starttls" | "tls" | "none";

export interface MailConfig {
  host: string;
  port: number;
  tls: SmtpTls;
  auth: { user: string; pass: string } | undefined;
  from: string;
}


const SMTP_TLS_MODES: readonly SmtpTls[] = ["starttls", "tls", "none"];

function smtpTls(env: ConfigSource): SmtpTls {
  return (env.SMTP_TLS || "starttls") as SmtpTls;
}

function smtpPort(env: ConfigSource): number {
  return env.SMTP_PORT ? Number(env.SMTP_PORT) : smtpTls(env) === "tls" ? 465 : 587;
}

// Every SMTP problem, checked independently, so startup validation can list
// them all rather than stopping at the first.
function smtpProblems(env: ConfigSource = configSource()): string[] {
  if (!env.SMTP_HOST) return [];

  const problems: string[] = [];
  if (!env.SMTP_FROM) problems.push("SMTP_FROM is required when SMTP_HOST is set");
  if (!SMTP_TLS_MODES.includes(smtpTls(env))) {
    problems.push(`SMTP_TLS must be starttls, tls or none, not "${env.SMTP_TLS}"`);
  }
  const port = smtpPort(env);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    problems.push(`SMTP_PORT must be a port number, not "${env.SMTP_PORT}"`);
  }
  if (!!env.SMTP_USER !== !!env.SMTP_PASSWORD) {
    problems.push("SMTP_USER and SMTP_PASSWORD must be set together");
  }
  return problems;
}

// Null when SMTP_HOST is unset: notifications are optional. Throws on a
// half-set config instead of quietly sending from nobody; callers log it.
export function readMailConfig(env: ConfigSource = configSource()): MailConfig | null {
  const host = env.SMTP_HOST;
  if (!host) return null;

  const problems = smtpProblems(env);
  if (problems.length > 0) throw new Error(problems.join("; "));

  const user = env.SMTP_USER;
  const pass = env.SMTP_PASSWORD;
  return {
    host,
    port: smtpPort(env),
    tls: smtpTls(env),
    auth: user && pass ? { user, pass } : undefined,
    from: env.SMTP_FROM as string,
  };
}

// Feature flags. Read like everything else, per call, so every replica
// sees the same value from the same config. An unrecognised value falls back
// to the default rather than failing the page; validateConfig reports it.

const TRUE_VALUES = ["true", "on", "1", "yes"];
const FALSE_VALUES = ["false", "off", "0", "no"];

function flagProblem(source: ConfigSource, name: string, allowed: readonly string[]) {
  const value = source[name];
  return value && !allowed.includes(value.toLowerCase())
    ? `${name} must be one of ${allowed.join(", ")}, not "${value}"`
    : undefined;
}

function readBoolean(source: ConfigSource, name: string, fallback: boolean): boolean {
  const value = source[name]?.toLowerCase();
  if (value && TRUE_VALUES.includes(value)) return true;
  if (value && FALSE_VALUES.includes(value)) return false;
  return fallback;
}

// Off turns the portal into a pure launcher (ADR-0001): /apps lists only
// what the user can open, and the request action refuses. Pending requests
// can still be decided.
export function readAccessRequestsEnabled(source: ConfigSource = configSource()): boolean {
  return readBoolean(source, "FEATURE_ACCESS_REQUESTS", true);
}

// Off pauses the access-request emails while keeping the SMTP settings in place.
export function readEmailNotificationsEnabled(source: ConfigSource = configSource()): boolean {
  return readBoolean(source, "FEATURE_EMAIL_NOTIFICATIONS", true);
}

// Off keeps the portal's own look and never asks PocketID for it.
export function readPocketIdBrandingEnabled(source: ConfigSource = configSource()): boolean {
  return readBoolean(source, "FEATURE_POCKETID_BRANDING", true);
}

// Off hides /admin/audit. The audit_log table is written regardless.
export function readAuditLogPageEnabled(source: ConfigSource = configSource()): boolean {
  return readBoolean(source, "FEATURE_AUDIT_LOG_PAGE", true);
}

// Off hides the readable-secrets admin banner for a deployer who has accepted the risk.
// The startup warning still logs, so the choice leaves a trace.
export function readSecretsWarningEnabled(source: ConfigSource = configSource()): boolean {
  return readBoolean(source, "WARN_POCKETID_SECRETS_READABLE", true);
}

const REASON_MODES = ["optional", "required", "off"] as const;
export type AccessRequestReason = (typeof REASON_MODES)[number];

export function readAccessRequestReason(
  source: ConfigSource = configSource(),
): AccessRequestReason {
  const value = source.ACCESS_REQUEST_REASON?.toLowerCase();
  return (REASON_MODES as readonly string[]).includes(value ?? "")
    ? (value as AccessRequestReason)
    : "optional";
}

// Flags set away from their defaults, as NAME=value, for one startup log
// line: support questions can then start from the log. Built from
// what each reader actually returns, so an unrecognised value (which falls
// back to the default, and validateConfig reports) isn't listed as a change.
export function nonDefaultFlags(source: ConfigSource = configSource()): string[] {
  const flags: Array<[string, string | boolean, string | boolean]> = [
    ["FEATURE_ACCESS_REQUESTS", readAccessRequestsEnabled(source), true],
    ["ACCESS_REQUEST_REASON", readAccessRequestReason(source), "optional"],
    ["FEATURE_EMAIL_NOTIFICATIONS", readEmailNotificationsEnabled(source), true],
    ["FEATURE_POCKETID_BRANDING", readPocketIdBrandingEnabled(source), true],
    ["FEATURE_AUDIT_LOG_PAGE", readAuditLogPageEnabled(source), true],
    ["WARN_POCKETID_SECRETS_READABLE", readSecretsWarningEnabled(source), true],
  ];
  return flags.filter(([, value, fallback]) => value !== fallback).map(([name, value]) => `${name}=${value}`);
}

// Test secrets this repository publishes, in .env.test and CI. Plain
// text is fine: they're already public, which is exactly the problem if a
// deployment reuses one. A test keeps this in step with .env.test.
const PUBLISHED_TEST_SECRETS: Readonly<Record<string, readonly string[]>> = {
  AUTH_SECRET: [
    "6f0a2f8e6e6a4f3f8b2b6f0e1d5c9a7b3e8f2c4a1d6b9e0f3a5c7d9b1e3f5a7c",
    "ci-smoke-secret-0000000000000000",
  ],
  // "ci-dummy" is the placeholder CI's compose smoke and Helm values use.
  POCKETID_API_KEY: [
    "37ee7a71a924242acac68e6dc80896cfdf7136b08d58022c935ea6ffd1d3413e",
    "ci-dummy",
  ],
  POCKETID_OIDC_CLIENT_SECRET: ["ci-dummy"],
  METRICS_TOKEN: ["e2e-metrics-token-0f3a5c7d9b1e3f5a7c"],
};

// Database passwords the repository publishes (.env.test, CI's compose smoke,
// the Helm chart's CI values). Matched against DATABASE_URL's password, so a
// copied one is caught whatever host the URL points at.
const PUBLISHED_DB_PASSWORDS = ["portal-test-fixture", "ci-smoke-not-a-real-password", "cismokepassword"];

// Read from the URL's userinfo directly, not with new URL(): postgres.js
// accepts several comma-separated hosts, which the WHATWG parser rejects.
function databasePassword(url: string | undefined): string | undefined {
  const userinfo = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)@/i.exec(url ?? "")?.[1] ?? "";
  const colon = userinfo.indexOf(":");
  if (colon === -1) return undefined;
  try {
    return decodeURIComponent(userinfo.slice(colon + 1)) || undefined;
  } catch {
    return undefined;
  }
}

// `openssl rand -base64 32` gives 44 characters; anything under 32 is too
// little randomness for a key that signs every session.
const MIN_AUTH_SECRET_LENGTH = 32;

// Production only: tests and CI use these fixtures on purpose.
function productionSecretProblems(source: ConfigSource): string[] {
  if (source.NODE_ENV !== "production") return [];

  const problems = Object.entries(PUBLISHED_TEST_SECRETS)
    .filter(([name, values]) => values.includes(source[name] ?? ""))
    .map(
      ([name]) =>
        `${name} is a published test value from this repository; anyone can use it. Generate your own`,
    );
  const dbPassword = databasePassword(source.DATABASE_URL);
  if (dbPassword && PUBLISHED_DB_PASSWORDS.includes(dbPassword)) {
    problems.push(
      "DATABASE_URL uses a published test password from this repository; anyone can use it. Set your own",
    );
  }
  const authSecret = source.AUTH_SECRET;
  if (authSecret && authSecret.length < MIN_AUTH_SECRET_LENGTH) {
    problems.push(
      `AUTH_SECRET is shorter than ${MIN_AUTH_SECRET_LENGTH} characters; generate one with openssl rand -base64 32`,
    );
  }
  return problems;
}

// Every problem at once, so a deployer fixes their config in one pass
// instead of one restart per missing variable. Logged at startup; it does
// not stop the portal, since each setting still fails where it's used.
export function validateConfig(source: ConfigSource = configSource()): string[] {
  const checks: Array<() => unknown> = [
    () => {
      const url = required(source, "POCKETID_BASE_URL");
      // Parsed on every page request (the CSP, the logo): a bad value would
      // otherwise surface far from its cause.
      let protocol = "";
      try {
        protocol = new URL(url).protocol;
      } catch {
        // falls through to the error below
      }
      if (protocol !== "http:" && protocol !== "https:") {
        throw new Error(`POCKETID_BASE_URL must be an absolute http(s) URL, not "${url}"`);
      }
    },
    () => required(source, "POCKETID_API_KEY"),
    () => required(source, "POCKETID_OIDC_CLIENT_ID"),
    () => required(source, "POCKETID_OIDC_CLIENT_SECRET"),
    // Read by next-auth itself, not by portal code, but login fails without it.
    () => required(source, "AUTH_SECRET"),
    () => readDatabaseUrl(source),
    () => readLogLevel(source),
  ];

  const problems: string[] = [];
  for (const check of checks) {
    try {
      check();
    } catch (error) {
      // Every check above throws an Error with a message naming the variable.
      problems.push((error as Error).message);
    }
  }
  // SMTP as its own list, one line per problem at startup; readMailConfig
  // throws them joined into a single error at send time.
  const flags = [
    flagProblem(source, "FEATURE_ACCESS_REQUESTS", [...TRUE_VALUES, ...FALSE_VALUES]),
    flagProblem(source, "ACCESS_REQUEST_REASON", REASON_MODES),
    ...[
      "FEATURE_EMAIL_NOTIFICATIONS",
      "FEATURE_POCKETID_BRANDING",
      "FEATURE_AUDIT_LOG_PAGE",
      "WARN_POCKETID_SECRETS_READABLE",
    ].map((name) => flagProblem(source, name, [...TRUE_VALUES, ...FALSE_VALUES])),
  ].filter((problem): problem is string => problem !== undefined);
  return [...problems, ...smtpProblems(source), ...flags, ...productionSecretProblems(source)];
}
