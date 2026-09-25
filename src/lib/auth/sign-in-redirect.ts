// Where signed-out visitors are sent: the home page, whose "Sign in with
// PocketID" button POSTs to Auth.js. A redirect straight to
// /api/auth/signin/pocketid is a GET, which Auth.js v5 rejects
// (UnknownAction) and turns into its "Configuration" error page.

// Only a path on this site: anything else would make the portal an open
// redirect ("//evil.test" and "/\evil.test" are other origins to a browser).
export function safeCallbackUrl(value: unknown): string {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}

export function signInUrl(returnTo?: string): string {
  const target = safeCallbackUrl(returnTo);
  return target === "/" ? "/" : `/?callbackUrl=${encodeURIComponent(target)}`;
}
