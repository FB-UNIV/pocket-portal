import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { readAuditLogPageEnabled } from "@/lib/config";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getDb } from "@/lib/db/client";
import { listAuditEvents, type AuditEntry } from "@/lib/audit/log";
import { formatUtcTimestamp } from "@/lib/format/utc-timestamp";

export const metadata: Metadata = {
  title: "Audit Log",
};

const PAGE_SIZE = 50;

// Every action the portal writes (docs/ARCHITECTURE.md, "What lands in the
// audit trail"), in lifecycle order. Doubles as the filter's allowlist.
const ACTION_LABELS: Record<string, string> = {
  "access_request.created": "Requested",
  "access_request.reopened": "Re-requested",
  "access_request.approved": "Approved",
  "access_request.denied": "Denied",
  "access_request.grant_rejected": "Grant refused",
  "access_request.grant_failed": "Grant failed",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// jsonb comes back untyped, and rows written by older code may lack a field.
function metadataString(metadata: unknown, key: string): string | undefined {
  if (typeof metadata !== "object" || metadata === null) return undefined;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function Details({ entry }: { entry: AuditEntry }) {
  const group = metadataString(entry.metadata, "pocketIdGroupName");
  const requesterSubject = metadataString(entry.metadata, "requesterSubject");
  // Only decision events record a requester; on the requester's own events
  // they are the actor, already shown.
  const requester = requesterSubject ? (entry.requesterEmail ?? requesterSubject) : undefined;
  const error = metadataString(entry.metadata, "error");

  return (
    <>
      {group ? <span className="font-medium text-black dark:text-zinc-50">{group}</span> : null}
      {requester ? <span> for {requester}</span> : null}
      {error ? (
        <span className="block text-xs text-zinc-600 dark:text-zinc-400">{error}</span>
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

  const { entries, nextCursor } = await listAuditEvents(getDb(), {
    action,
    before,
    limit: PAGE_SIZE,
  });

  return (
    <div className="flex flex-col flex-1 items-center bg-zinc-50 dark:bg-black">
      <main
        id="main-content"
        tabIndex={-1}
        className="flex w-full max-w-4xl flex-col gap-8 py-16 px-6 sm:px-16 bg-white dark:bg-black"
      >
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Audit Log (Admin)
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Every access request and decision, newest first, including grants
            that were refused or failed.
          </p>
        </div>

        {/* A plain GET form: the filter is just a URL, so it survives a
            reload and can be shared. */}
        <form action="/admin/audit" className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="audit-action" className="text-xs text-zinc-600 dark:text-zinc-400">
              Action
            </label>
            <select
              id="audit-action"
              name="action"
              defaultValue={action ?? ""}
              className="rounded-lg border border-black/[.15] bg-transparent px-2 py-2 text-sm dark:border-white/[.2]"
            >
              <option value="">All actions</option>
              {Object.entries(ACTION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="rounded-full border border-black/[.15] px-4 py-2 text-sm transition-colors hover:bg-zinc-100 dark:border-white/[.2] dark:hover:bg-zinc-900"
          >
            Filter
          </button>
        </form>

        {entries.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {action || before ? "No audit events match." : "No audit events yet."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-zinc-600 dark:text-zinc-400">
                <tr>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Time
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Event
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    By
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Details
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr
                    key={entry.id}
                    className="border-t border-black/[.08] align-top dark:border-white/[.145]"
                  >
                    <td className="py-2 pr-4 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                      <time dateTime={entry.createdAt.toISOString()}>
                        {formatUtcTimestamp(entry.createdAt)}
                      </time>
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {ACTION_LABELS[entry.action] ?? entry.action}
                    </td>
                    <td className="py-2 pr-4 break-all">
                      {entry.actorEmail ?? entry.actorSubject}
                    </td>
                    <td className="py-2">
                      <Details entry={entry} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {before || nextCursor ? (
          <nav aria-label="Audit log pages" className="flex gap-4 text-sm">
            {before ? (
              <Link href={auditHref({ action })} className="underline underline-offset-4">
                Newest events
              </Link>
            ) : null}
            {nextCursor ? (
              <Link
                href={auditHref({ action, before: nextCursor })}
                className="underline underline-offset-4"
              >
                Older events
              </Link>
            ) : null}
          </nav>
        ) : null}
      </main>
    </div>
  );
}
