import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { readAuditLogPageEnabled } from "@/lib/config";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getDb } from "@/lib/db/client";
import { getPocketIdConfig } from "@/lib/pocketid/client";
import { pocketIdDisplayNames } from "@/lib/pocketid/display-names";
import { listAuditEvents, type AuditEntry } from "@/lib/audit/log";
import { utcDayParts } from "@/lib/format/utc-timestamp";
import { getLocale, getTranslations } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("AdminAudit");
  return { title: t("title") };
}

type AuditT = Awaited<ReturnType<typeof getTranslations<"AdminAudit">>>;

const PAGE_SIZE = 50;

// The filters, each a set of the actions the portal writes
// (docs/ARCHITECTURE.md, "What lands in the audit trail"). Doubles as the
// allowlist for ?show=.
const FILTERS = {
  requests: { label: "filterRequests", actions: ["access_request.created", "access_request.reopened"] },
  approved: { label: "filterApproved", actions: ["access_request.approved"] },
  declined: { label: "filterDeclined", actions: ["access_request.denied"] },
  problems: {
    label: "filterProblems",
    actions: ["access_request.grant_rejected", "access_request.grant_failed", "notification.failed"],
  },
} as const;
type Filter = keyof typeof FILTERS;

// Each event's sentence, and the mark beside it: asking is something to
// decide, done is ok, refused or failed is bad. The words always say which.
const EVENTS = {
  "access_request.created": { message: "evCreated", tone: "tip", mark: "?" },
  "access_request.reopened": { message: "evReopened", tone: "tip", mark: "?" },
  "access_request.approved": { message: "evApproved", tone: "ok", mark: "✓" },
  "access_request.denied": { message: "evDenied", tone: "muted", mark: "–" },
  "access_request.grant_rejected": { message: "evGrantRejected", tone: "bad", mark: "!" },
  "access_request.grant_failed": { message: "evGrantFailed", tone: "bad", mark: "!" },
  // An email the outbox gave up on (ADR-0011); written by the system, so
  // the sentence names who it was for rather than who did it.
  "notification.failed": { message: "evEmailFailed", tone: "bad", mark: "!" },
  // An admin linking or unlinking two apps (ADR-0012), by the names they
  // had then.
  "app_dependency.added": { message: "evDependencyAdded", tone: "muted", mark: "+" },
  "app_dependency.removed": { message: "evDependencyRemoved", tone: "muted", mark: "–" },
  // News posts (#22), by the title they had then.
  "news.created": { message: "evNewsCreated", tone: "muted", mark: "+" },
  "news.updated": { message: "evNewsUpdated", tone: "muted", mark: "·" },
  "news.deleted": { message: "evNewsDeleted", tone: "muted", mark: "–" },
} as const;

const TONES = {
  tip: "bg-tip text-on-tip",
  ok: "bg-ok text-on-ok",
  muted: "bg-surface-muted text-ink-muted",
  bad: "bg-bad text-on-bad",
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// jsonb comes back untyped, and rows written by older code may lack a field.
function metadataString(metadata: unknown, key: string): string | undefined {
  if (typeof metadata !== "object" || metadata === null) return undefined;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function auditHref(params: { show?: Filter; before?: string }): string {
  const query = new URLSearchParams();
  if (params.show) query.set("show", params.show);
  if (params.before) query.set("before", params.before);
  const search = query.toString();
  return search ? `/admin/audit?${search}` : "/admin/audit";
}

function EventSentence({
  entry,
  names,
  t,
}: {
  entry: AuditEntry;
  names: Map<string, string>;
  t: AuditT;
}) {
  const actor = names.get(entry.actorSubject) ?? entry.actorEmail ?? entry.actorSubject;
  if (!Object.hasOwn(EVENTS, entry.action)) {
    return <>{t("evUnknown", { actor, action: entry.action })}</>;
  }
  // Only decision events record a requester; on the requester's own events
  // they are the actor.
  const requesterSubject = metadataString(entry.metadata, "requesterSubject");
  const requester = requesterSubject
    ? (names.get(requesterSubject) ?? entry.requesterEmail ?? requesterSubject)
    : t("someone");
  const group = metadataString(entry.metadata, "pocketIdGroupName") ?? t("someGroup");
  const recipient = metadataString(entry.metadata, "recipientEmail") ?? t("someone");
  const app = metadataString(entry.metadata, "appName") ?? t("someApp");
  const prerequisite = metadataString(entry.metadata, "requiresName") ?? t("someApp");
  const title = metadataString(entry.metadata, "title") ?? t("somePost");
  return (
    <>
      {t.rich(EVENTS[entry.action as keyof typeof EVENTS].message, {
        actor,
        requester,
        group,
        recipient,
        app,
        prerequisite,
        title,
        // The sentence is bold, so the people and the group stand out; the
        // words between them are quieter.
        muted: (chunks) => <span className="font-normal text-ink-muted">{chunks}</span>,
      })}
    </>
  );
}

// Read-only view of the audit_log table (ADR-0006): the history behind
// the request queue, including grants that never happened and why, told as
// sentences grouped by (UTC) day.
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Hidden by FEATURE_AUDIT_LOG_PAGE; events are still written.
  if (!readAuditLogPageEnabled()) notFound();
  await requireAdmin("/admin/audit");

  const params = await searchParams;
  // Query params are user input. An unknown filter or a malformed cursor is
  // dropped rather than passed on: the cursor would reach Postgres as an
  // invalid uuid and fail the page.
  const show =
    typeof params.show === "string" && Object.hasOwn(FILTERS, params.show)
      ? (params.show as Filter)
      : undefined;
  const before =
    typeof params.before === "string" && UUID.test(params.before) ? params.before : undefined;

  const [{ entries, nextCursor }, t, locale] = await Promise.all([
    listAuditEvents(getDb(), {
      actions: show ? [...FILTERS[show].actions] : undefined,
      before,
      limit: PAGE_SIZE,
    }),
    getTranslations("AdminAudit"),
    getLocale(),
  ]);
  const names = entries.length > 0 ? await pocketIdDisplayNames(getPocketIdConfig()) : new Map<string, string>();

  const now = new Date();
  const days: { label: string; entries: { entry: AuditEntry; time: string }[] }[] = [];
  for (const entry of entries) {
    const when = utcDayParts(entry.createdAt, now, locale);
    const label = when.day === "today" ? t("today") : when.day === "yesterday" ? t("yesterday") : when.date;
    let day = days.at(-1);
    if (day?.label !== label) days.push((day = { label, entries: [] }));
    day.entries.push({ entry, time: when.time });
  }

  const filters: { key: Filter | undefined; label: string }[] = [
    { key: undefined, label: t("everything") },
    ...(Object.keys(FILTERS) as Filter[]).map((key) => ({ key, label: t(FILTERS[key].label) })),
  ];

  return (
    <main id="main-content" tabIndex={-1} className="flex flex-col gap-7">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <h1 className="text-4xl font-extrabold tracking-tight text-ink sm:text-[44px] sm:leading-[1.05]">
          {t("title")}
        </h1>
        {/* Links, not a form: each filter is just a URL, so it survives a
            reload and can be shared. */}
        <nav aria-label={t("filterLabel")}>
          <ul className="flex flex-wrap gap-2">
            {filters.map(({ key, label }) => (
              <li key={key ?? "all"}>
                <Link
                  href={auditHref({ show: key })}
                  aria-current={key === show ? "page" : undefined}
                  className="chip"
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      {entries.length === 0 ? (
        <p className="card p-6 text-ink-muted">{show || before ? t("noMatch") : t("none")}</p>
      ) : (
        days.map((day) => (
          <section key={day.label} aria-label={day.label} className="flex flex-col gap-2.5">
            <h2 className="text-[15px] font-bold text-ink-muted">{day.label}</h2>
            <ul className="card divide-y divide-line overflow-hidden">
              {day.entries.map(({ entry, time }) => {
                const event = Object.hasOwn(EVENTS, entry.action)
                  ? EVENTS[entry.action as keyof typeof EVENTS]
                  : { tone: "muted", mark: "·" } as const;
                const error = metadataString(entry.metadata, "error");
                return (
                  <li key={entry.id} className="flex items-start gap-4 px-5 py-4 sm:px-6">
                    <span
                      aria-hidden="true"
                      className={`inline-flex h-9 w-9 flex-none items-center justify-center rounded-full text-[17px] font-extrabold ${TONES[event.tone]}`}
                    >
                      {event.mark}
                    </span>
                    <div className="min-w-0 flex-1 pt-1.5">
                      <p className="leading-snug font-bold break-words">
                        <EventSentence entry={entry} names={names} t={t} />
                      </p>
                      {error ? <p className="mt-0.5 text-sm text-on-bad">{error}</p> : null}
                    </div>
                    <time
                      dateTime={entry.createdAt.toISOString()}
                      className="pt-2 text-sm whitespace-nowrap text-ink-muted tabular-nums"
                    >
                      {time}
                    </time>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {before || nextCursor ? (
        <nav aria-label={t("pagesLabel")} className="flex gap-2">
          {before ? (
            <Link href={auditHref({ show })} className="btn btn-secondary">
              {t("newest")}
            </Link>
          ) : null}
          {nextCursor ? (
            <Link href={auditHref({ show, before: nextCursor })} className="btn btn-secondary">
              {t("older")}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </main>
  );
}
