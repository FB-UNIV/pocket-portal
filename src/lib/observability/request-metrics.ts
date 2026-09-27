import { recordHttpRequest } from "@/lib/observability/metrics";
import { handledRequest, type EndedSpan } from "@/lib/observability/request-log";

// Counts every request from the span Next ends for it, like the request
// log, but always on: LOG_REQUESTS only silences the log line.
export class RequestMetricsProcessor {
  onStart(): void {}

  onEnd(span: EndedSpan): void {
    const request = handledRequest(span);
    if (request) recordHttpRequest(request.method, request.route, request.status, request.durationSeconds);
  }

  async forceFlush(): Promise<void> {}

  async shutdown(): Promise<void> {}
}
