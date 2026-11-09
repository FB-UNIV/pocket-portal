import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { readAuditLogPageEnabled } from "@/lib/config";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getDb } from "@/lib/db/client";
import { listAuditEvents, type AuditEntry } from "@/lib/audit/log";
import { formatUtcTimestamp } from "@/lib/format/utc-timestamp";
import { getLocale, getTranslations } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("AdminAudit");
  return { title: t("title") };
}

type AuditT = Awaited<ReturnType<typeof getTranslations<"AdminAudit">>>;

const PAGE_SIZE = 50;

// Every action the portal writes (docs/ARCHITECTURE.md, "What lands in the
// audit trail"), in lifecycle order, with its label's message key. Doubles
// as the filter's allowlist.
const ACTION_LABELS = {
  "access_request.created": "created",
  "access_request.reopened": "reopened",
  "access_request.approved": "approved",
  "access_request.denied": "denied",
  "access_request.grant_rejected": "grant_rejected",
  "access_request.grant_failed": "grant_failed",
} as const;

function actionLabel(t: AuditT, action: string): string {
  return Object.hasOwn(ACTION_LABELS, action)
    ? t(ACTION_LABELS[action as keyof typeof ACTION_LABELS])
    : action;
}

// The badge each event wears: done is ok, refused or failed is bad, and
// someone asking is a tip (something to decide). Text always names it.
const ACTION_TONES: Record<string, string> = {
  "access_request.created": "badge-tip",
  "access_request.reopened": "badge-tip",
  "access_request.approved": "badge-ok",
  "access_request.denied": "",
  "access_request.grant_rejected": "badge-bad",
  "access_request.grant_failed": "badge-bad",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// jsonb comes back untyped, and rows written by older code may lack a field.
function metadataString(metadata: unknown, key: string): string | undefined {
  if (typeof metadata !== "object" || metadata === null) return undefined;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function Details({ entry, t }: { entry: AuditEntry; t: AuditT }) {
  const group = metadataString(entry.metadata, "pocketIdGroupName");
  const requesterSubject = metadataString(entry.metadata, "requesterSubject");
  // Only decision events record a requester; on the requester's own events
  // they are the actor, already shown.
  const requester = requesterSubject ? (entry.requesterEmail ?? requesterSubject) : undefined;
  const error = metadataString(entry.metadata, "error");

  return (
    <>
      {group ? <span className="font-medium text-ink">{group}</span> : null}
      {requester ? <span> {t("forRequester", { requester })}</span> : null}
      {error ? (
        <span className="block text-xs text-ink-muted">{error}</span>
      ) : null}
    </>
  );
}

function auditHref(params: { action?: string; before?: string }): string {
  const query = new URLSearchParams();
  if (params.action) query.set("action", params.action);
  if (params.before) query.set("before", params.before);
  const search = query.toString();
  return search ? `/admin/audit?${search}` : "/admin/audit";
}

// Read-only view of the audit_log table (ADR-0006): the history behind
// the request queue, including grants that never happened and why.
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Hidden by FEATURE_AUDIT_LOG_PAGE; events are still written.
  if (!readAuditLogPageEnabled()) notFound();
  await requireAdmin("/admin/audit");

  const params = await searchParams;
  // Query params are user input. An unknown action or a malformed cursor is
  // dropped rather than passed on: the cursor would reach Postgres as an
  // invalid uuid and fail the page.
  const action =
    typeof params.action === "string" && Object.hasOwn(ACTION_LABELS, params.action)
      ? params.action
      : undefined;
  const before =
    typeof params.before === "string" && UUID.test(params.before) ? params.before : undefined;

  const [{ entries, nextCursor }, t, locale] = await Promise.all([
    listAuditEvents(getDb(), { action, before, limit: PAGE_SIZE }),
    getTranslations("AdminAudit"),
    getLocale(),
  ]);

  return (
    <main id="main-content" tabIndex={-1} className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">{t("title")}</h1>
        <p className="mt-2 max-w-2xl text-ink-muted">{t("intro")}</p>
      </div>

      {/* A plain GET form: the filter is just a URL, so it survives a
          reload and can be shared. */}
      <form action="/admin/audit" className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="audit-action" className="text-sm font-semibold text-ink-muted">
            {t("show")}
          </label>
          <select
            id="audit-action"
            name="action"
            defaultValue={action ?? ""}
            className="field min-h-11 w-56"
          >
            <option value="">{t("everything")}</option>
            {Object.keys(ACTION_LABELS).map((value) => (
              <option key={value} value={value}>
                {actionLabel(t, value)}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn-secondary">
          {t("filter")}
        </button>
      </form>

      {entries.length === 0 ? (
        <div className="card p-6">
          <p className="text-ink-muted">
            {action || before ? t("noMatch") : t("none")}
          </p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t("columnWhen")}</th>
                <th scope="col">{t("columnWhat")}</th>
                <th scope="col">{t("columnBy")}</th>
                <th scope="col">{t("columnDetails")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="align-top">
                  <td className="whitespace-nowrap text-sm text-ink-muted">
                    <time dateTime={entry.createdAt.toISOString()}>
                      {formatUtcTimestamp(entry.createdAt, locale)}
                    </time>
                  </td>
                  <td>
                    <span className={`badge ${ACTION_TONES[entry.action] ?? ""}`}>
                      {actionLabel(t, entry.action)}
                    </span>
                  </td>
                  <td className="break-all">{entry.actorEmail ?? entry.actorSubject}</td>
                  <td>
                    <Details entry={entry} t={t} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {before || nextCursor ? (
        <nav aria-label={t("pagesLabel")} className="flex gap-2">
          {before ? (
            <Link href={auditHref({ action })} className="btn btn-secondary">
              {t("newest")}
            </Link>
          ) : null}
          {nextCursor ? (
            <Link href={auditHref({ action, before: nextCursor })} className="btn btn-secondary">
              {t("older")}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </main>
  );
}
