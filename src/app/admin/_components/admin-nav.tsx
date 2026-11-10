import { auth } from "@/auth";
import { readAccessRequestsEnabled, readAuditLogPageEnabled } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { listPendingAccessRequests } from "@/lib/requests/access-requests";
import { getTranslations } from "@/i18n/server";
import { AdminNavLinks, type AdminNavItem } from "./admin-nav-links";

// Pending requests, or null when they couldn't be read: the tabs aren't
// worth failing every admin page over, and the requests page reports it.
async function pendingCount(): Promise<number | null> {
  try {
    return (await listPendingAccessRequests(getDb())).length;
  } catch {
    return null;
  }
}

// The tabs on top of every /admin page. Each page still runs requireAdmin;
// this renders nothing for anyone else, so their render never asks the DB.
export async function AdminNav() {
  const session = await auth();
  if (!session?.user?.isAdmin) return null;

  const [pending, t] = await Promise.all([pendingCount(), getTranslations("AdminNav")]);
  const items: AdminNavItem[] = [];
  // As in the header: switched off, the queue stays reachable only while
  // something filed before still waits (or the count couldn't be read).
  if (readAccessRequestsEnabled() || pending !== 0) {
    items.push({
      href: "/admin/requests",
      label: t("requests"),
      count: pending ?? undefined,
      countLabel: pending ? t("waiting", { count: pending }) : undefined,
    });
  }
  items.push({ href: "/admin/apps", label: t("catalog") });
  if (readAuditLogPageEnabled()) {
    items.push({ href: "/admin/audit", label: t("history") });
  }

  return (
    <nav aria-label={t("label")} className="max-w-full self-start">
      <AdminNavLinks items={items} />
    </nav>
  );
}
