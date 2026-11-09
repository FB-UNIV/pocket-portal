import { auth } from "@/auth";
import { readAccessRequestsEnabled, readAuditLogPageEnabled } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { listPendingAccessRequests } from "@/lib/requests/access-requests";
import { AdminNavLinks, type AdminNavItem } from "./admin-nav-links";

// Pending requests, or null when they couldn't be read: a side menu isn't
// worth failing every admin page over, and the requests page reports it.
async function pendingCount(): Promise<number | null> {
  try {
    return (await listPendingAccessRequests(getDb())).length;
  } catch {
    return null;
  }
}

// The side menu on every /admin page. Each page still runs requireAdmin;
// this renders nothing for anyone else, so their render never asks the DB.
export async function AdminNav() {
  const session = await auth();
  if (!session?.user?.isAdmin) return null;

  const pending = await pendingCount();
  const items: AdminNavItem[] = [];
  // As in the header: switched off, the queue stays reachable only while
  // something filed before still waits (or the count couldn't be read).
  if (readAccessRequestsEnabled() || pending !== 0) {
    items.push({ href: "/admin/requests", label: "Requests", count: pending ?? undefined });
  }
  items.push({ href: "/admin/apps", label: "App catalog" });
  if (readAuditLogPageEnabled()) {
    items.push({ href: "/admin/audit", label: "History" });
  }

  return (
    <nav aria-label="Admin" className="lg:sticky lg:top-6 lg:w-52 lg:shrink-0 lg:self-start">
      <p className="mb-2 hidden px-4 text-xs font-bold tracking-wide text-ink-muted uppercase lg:block">
        Admin
      </p>
      <AdminNavLinks items={items} />
    </nav>
  );
}
