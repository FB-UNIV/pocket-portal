// Keeps query strings out of exported traces (#4). Next's request span
// carries the full `http.target`, and on the OIDC callback that is the
// sign-in authorization code and state (seen on a real build); elsewhere a
// query can carry a search term. The request log already drops it; this
// does the same for traces, so a credential never sits in whatever stores
// them.
//
// Done in onEnding, which the SDK calls inside span.end() once every
// attribute is set but before the span is read-only and handed to the
// exporter: a supported hook, rather than rewriting ended spans.

const URL_ATTRIBUTES = ["http.target", "http.url", "url.full"] as const;

// What onEnding is handed: a span that can still be written.
interface EndingSpan {
  attributes: Record<string, unknown>;
  setAttribute(key: string, value: string): unknown;
}

export function withoutQuery(value: string): string {
  const cut = value.search(/[?#]/);
  return cut === -1 ? value : value.slice(0, cut);
}

export class QueryRedactionProcessor {
  onStart(): void {}

  onEnding(span: EndingSpan): void {
    for (const key of URL_ATTRIBUTES) {
      const value = span.attributes[key];
      if (typeof value === "string" && /[?#]/.test(value)) span.setAttribute(key, withoutQuery(value));
    }
    // Can't be removed once set, so blanked.
    if (span.attributes["url.query"] !== undefined) span.setAttribute("url.query", "[redacted]");
  }

  onEnd(): void {}

  async forceFlush(): Promise<void> {}

  async shutdown(): Promise<void> {}
}
