// Response security headers. Dependency-free, because next.config.ts
// imports it too.

// Per-request Content-Security-Policy, set by src/proxy.ts with a fresh nonce
// (Next applies it to its own scripts).
//
// - script-src: nonced scripts, and whatever they load ('strict-dynamic').
// - style-src 'unsafe-inline': the branding sets CSS variables in a style
//   attribute on <html>, which a nonce can't cover. Inline styles are
//   far less dangerous than inline scripts.
// - form-action and img-src include PocketID: the sign-in form's response
//   redirects to its /authorize (form-action applies to that redirect), and
//   the header logo is served from it.
// - frame-ancestors 'none': nobody may frame the portal, so the admin Approve
//   button can't be clickjacked.
// - No upgrade-insecure-requests: it breaks plain-HTTP localhost, and TLS is
//   the reverse proxy's job.
export function buildContentSecurityPolicy({
  nonce,
  pocketIdOrigin,
  dev,
}: {
  nonce: string;
  pocketIdOrigin: string | undefined;
  dev: boolean;
}): string {
  const pocketId = pocketIdOrigin ? ` ${pocketIdOrigin}` : "";
  return [
    "default-src 'self'",
    // Next's dev server evaluates code for fast refresh.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data:${pocketId}`,
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    `form-action 'self'${pocketId}`,
    "frame-ancestors 'none'",
  ].join("; ");
}

// The origin of an absolute http(s) URL, or undefined for anything else.
// src/proxy.ts runs this on every page request, so a malformed
// POCKETID_BASE_URL must leave PocketID out of the CSP rather than throw and
// fail every page; validateConfig reports the bad value at startup.
export function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : undefined;
  } catch {
    return undefined;
  }
}

// Headers that don't vary per request, set on every response (static assets
// included) from next.config.ts. HSTS isn't here: only the TLS-terminating
// proxy knows the portal is on HTTPS (docs/RUNBOOK.md, reverse proxy).
export const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  // frame-ancestors' predecessor, for browsers without CSP level 2.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];
