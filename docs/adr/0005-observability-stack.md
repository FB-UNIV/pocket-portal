# ADR-0005: Observability stack — Pino, OpenTelemetry, prom-client

**Date**: 2026-09-20
**Status**: accepted (amended 2026-09-22 — see [Amendment](#amendment-2026-09-22-signals-not-a-stack))
**Deciders**: François Bouju

## Context

The portal needs structured logging, distributed tracing, and Prometheus
metrics. The homelab already runs (or is intended to run) Prometheus and
Grafana, which strongly constrains the metrics choice toward something
Prometheus can scrape directly. Next.js has official, self-hostable
OpenTelemetry support (`@vercel/otel` + `instrumentation.ts`, confirmed via
Next.js's own docs — not Vercel-platform-locked). Sentry was considered
given its excellent Next.js SDK, but self-hosting it requires 4 CPU cores +
16GB RAM minimum (per Sentry's own self-hosting docs) — disproportionate for
a homelab side project — and its SaaS tier doesn't produce literal
Prometheus metrics (Sentry's own custom-metrics product was sunset).

## Decision

- **Logging**: Pino, structured JSON to stdout. Container log collection
  (e.g. Grafana Alloy/Promtail → Loki) handles shipping; the app does no
  export itself.
- **Tracing**: OpenTelemetry via `@vercel/otel` and `instrumentation.ts`,
  exporting OTLP to a self-hosted collector (e.g. Grafana Tempo or an
  OTel Collector).
- **Metrics**: `prom-client`, exposing a `/api/metrics` route handler in
  Prometheus text format, scraped directly by the homelab's Prometheus —
  no OTel Collector needed for this path.

## Alternatives Considered

### Alternative 1: Route metrics through OpenTelemetry too (`@opentelemetry/exporter-prometheus`)
- **Pros**: single SDK/instrumentation surface for both traces and metrics.
- **Cons**: OpenTelemetry's own docs recommend OTLP over the Prometheus
  exporter as best practice, treating the Prometheus exporter as legitimate
  only when infrastructure already standardizes on Prometheus scraping —
  which is true here, but `prom-client` is simpler and far more
  battle-tested for exactly this scrape model.
- **Why not**: no real benefit over `prom-client` for this project's scale,
  and it would add OTel-metrics-specific packages/config for no gain.

### Alternative 2: Sentry (SaaS or self-hosted)
- **Pros**: excellent Next.js SDK, auto-instruments most of the app,
  first-class error tracking + session replay, zero-ops on the free SaaS
  tier.
- **Cons**: self-hosting needs 4 CPU/16GB RAM minimum; SaaS tier has no
  Prometheus-compatible metrics output; would mean running two separate
  observability surfaces (Sentry for errors/traces, prom-client for
  metrics) with overlapping tracing concerns.
- **Why not**: doesn't satisfy the explicit Prometheus requirement, and
  self-hosting is disproportionate to project scale.

### Alternative 3: All-in-one self-hosted OTel-native platform (SigNoz, Uptrace)
- **Pros**: one service instead of separately running Prometheus + Grafana
  + Loki + Tempo.
- **Cons**: still real infrastructure to operate (typically
  ClickHouse-backed); doesn't scrape Prometheus format, so it wouldn't
  reuse Prometheus/Grafana already in place in the homelab.
- **Why not**: the homelab already has (or will have) Prometheus + Grafana;
  replacing that with a new platform is more disruptive than extending it
  with Loki/Tempo.

## Consequences

### Positive
- Reuses existing homelab observability infrastructure (Prometheus,
  Grafana) rather than introducing a parallel platform.
- Each concern uses its most standard, battle-tested tool rather than one
  framework stretched across all three.
- Fully self-hosted — no dependency on a third-party SaaS free-tier quota.

### Negative
- Three separate libraries/surfaces to wire up (Pino, OTel, prom-client)
  instead of one unified SDK.
- Requires the homelab operator (the user) to actually run/maintain
  Prometheus, Grafana, and a trace backend (Tempo or an OTel Collector) —
  this ADR assumes that infrastructure exists or will be stood up
  alongside the portal.

### Risks
- `/api/metrics` must not leak sensitive data (request bodies, PII) in
  metric labels — keep labels to route/status/method-shaped values.
- Multiple stateless replicas each expose their own `prom-client` registry;
  Prometheus scraping each pod/replica and aggregating via `sum()` at query
  time is the correct pattern (not a shared counter) — consistent with the
  project's stateless/HA rule.

## Amendment (2026-09-22): signals, not a stack

This ADR assumed a specific consuming stack — "the homelab already runs
(or is intended to run) Prometheus and Grafana", with Loki/Alloy for logs
and Tempo for traces. That assumption no longer holds and should not be
read as part of the decision.

**Why it changed.** The project is being prepared for open source, and
The project settled that it ships a deployment *contract* rather than a hosting
target. An ADR that names the operator's monitoring stack is exactly the
kind of assumption a stranger deploying this has to undo. It was also
already inaccurate: the machine this was written on runs Graylog, not
Prometheus/Grafana/Loki/Tempo.

**What still stands** — the actual decisions, unchanged:

- Pino for structured logging, OpenTelemetry via `@vercel/otel` for
  tracing, `prom-client` for metrics.
- Three focused libraries rather than one framework stretched across all
  three concerns.
- Fully self-hostable, no SaaS dependency. The Sentry analysis in
  Alternatives is unaffected.

**What is amended** — the app emits signals and is indifferent to what
consumes them:

| Signal | Interface | Consumer |
|---|---|---|
| Metrics | `GET /api/metrics`, Prometheus text format | Deployer's choice — Prometheus, VictoriaMetrics, anything that scrapes |
| Logs | structured JSON on stdout | Whatever reads container stdout |
| Traces | OTLP, only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set | Any OTLP-compatible collector; absent that, tracing simply does not export |

Prometheus *text format* remains a real constraint on the metrics
library — that is an interface commitment, not a claim about what the
operator runs. Choosing and running a monitoring stack is out of scope
for this project; `docs/RUNBOOK.md` documents the signals and leaves
alerting to the deployer.

## Amendment (2026-09-24): metrics are closed by default

The original decision had `/api/metrics` "scraped directly" without saying
who else could reach it, so anyone with network access to the portal could
read its runtime telemetry. That was never a deliberate choice.

**Decision.** `/api/metrics` is served only when `METRICS_TOKEN` is set and
the request presents it as `Authorization: Bearer <token>`, compared in
constant time. Every other request gets a 404, including every request when
the variable is unset. The startup log states which of the two an instance
is in.

- **Closed rather than open when unset**, because a deployment that follows
  `.env.example` and nothing else should not leak anything. Changing
  this default after 1.0 would be a breaking change, which is why it was
  settled before.
- **A token rather than proxy rules or a second listener.** A proxy rule
  fails open when the proxy is misconfigured or bypassed. A separate port
  fights `output: "standalone"`'s single-server model.
- **`route` labels are route patterns, never raw paths**, so label
  cardinality is bounded by the route table rather than by whatever paths a
  client sends. This is recorded next to `recordHttpRequest`, which has no
  callers yet.
