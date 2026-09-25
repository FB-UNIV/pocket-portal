// An app's launch URL is rendered straight into <a href>, and React does not
// sanitize href. PocketID stores any string as a client's launchURL
// (verified live: `javascript:alert(1)` is accepted and returned as-is), so
// this is the only guard between that config and script running in the
// portal's own origin.
//
// Parsed with the URL parser rather than matched by prefix, so mixed case,
// leading whitespace and embedded tabs/newlines are normalised the same way
// a browser would before the scheme is checked. Anything that isn't an
// absolute http(s) URL becomes null, which the catalog already treats as
// "no launch URL".
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

export function safeLaunchUrl(raw: string | null): string | null {
  if (!raw) return null;

  try {
    return ALLOWED_PROTOCOLS.has(new URL(raw).protocol) ? raw : null;
  } catch {
    return null;
  }
}
