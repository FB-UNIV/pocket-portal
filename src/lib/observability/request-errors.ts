import { logger as defaultLogger } from "@/lib/observability/logger";

type Log = Pick<typeof defaultLogger, "error">;

// What Next passes onRequestError (instrumentation.ts).
interface FailedRequest {
  path: string;
  method: string;
  // Never logged: they carry the session cookie.
  headers?: unknown;
}

interface FailureContext {
  routePath: string;
  routeType: string;
}

// A server error, with its stack and the digest the user's error page shows,
// so a report of "digest 123" leads to this line.
export function logRequestError(
  err: unknown,
  request: FailedRequest,
  context: FailureContext,
  log: Log = defaultLogger,
): void {
  const message = err instanceof Error ? err.message : String(err);
  const digest =
    typeof err === "object" && err !== null && "digest" in err
      ? String((err as { digest: unknown }).digest)
      : undefined;
  const path = request.path.split("?")[0];

  log.error(
    { err, digest, method: request.method, path, route: context.routePath, routeType: context.routeType },
    `${request.method} ${path} failed: ${message}`,
  );
}
