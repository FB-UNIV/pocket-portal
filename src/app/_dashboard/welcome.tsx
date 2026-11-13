import { getDb } from "@/lib/db/client";
import { getPocketIdConfig } from "@/lib/pocketid/client";
import { listUserCatalogApps } from "@/lib/catalog/apps";
import { listUserAccessRequests } from "@/lib/requests/access-requests";
import { getOnboarding } from "@/lib/onboarding/store";
import { buildChecklist, checklistVisible, type ChecklistItem } from "@/lib/onboarding/checklist";
import { readAccessRequestsEnabled, readPocketIdBaseUrl } from "@/lib/config";
import { getLocale, getTranslations } from "@/i18n/server";
import { DashboardSection, loadSection } from "./section";
import { dismissChecklistAction, tickChecklistItemAction } from "./actions";

const SECTION_ID = "welcome";

// Where a person adds a passkey: PocketID's own account page
// (frontend/src/routes/settings/account, which lists their passkeys).
function pocketIdAccountUrl(): string | null {
  const base = readPocketIdBaseUrl();
  return base ? `${base.replace(/\/+$/, "")}/settings/account` : null;
}

type WelcomeT = Awaited<ReturnType<typeof getTranslations<"Welcome">>>;

// The welcome checklist (#21): first on the dashboard while something's
// left to do, gone once it's all done or hidden. A dashboard section
// (./section); unlike the others it has no error card: if it can't load,
// it just isn't there, since nothing on it is urgent.
export async function WelcomeChecklist({ userId, userGroups }: { userId: string; userGroups: string[] }) {
  const loaded = await loadSection("Getting started", async () => {
    const db = getDb();
    const [apps, requests, onboarding] = await Promise.all([
      listUserCatalogApps(getPocketIdConfig(), db, userGroups),
      listUserAccessRequests(db, userId),
      getOnboarding(db, userId),
    ]);
    return { apps, requests, onboarding };
  });
  if (!loaded.ok) return null;

  const { apps, requests, onboarding } = loaded.value;
  const items = buildChecklist({
    apps,
    requestCount: requests.length,
    ticked: onboarding.tickedItems,
    requestsEnabled: readAccessRequestsEnabled(),
    accountUrl: pocketIdAccountUrl(),
  });
  if (!checklistVisible(items, onboarding.checklistDismissedAt)) return null;

  const [t, locale] = await Promise.all([getTranslations("Welcome"), getLocale()]);
  const done = items.filter((item) => item.done).length;

  return (
    <DashboardSection
      id={SECTION_ID}
      heading={t("heading")}
      action={
        <form action={dismissChecklistAction}>
          <button type="submit" className="text-[15px] font-semibold text-ink-muted underline underline-offset-4 hover:text-ink">
            {t("dismiss")}
          </button>
        </form>
      }
    >
      <p className="-mt-3 text-[15px] text-ink-muted">{t("progress", { done, total: items.length })}</p>
      <ol className="card flex flex-col divide-y divide-line">
        {items.map((item) => (
          <Item key={item.id} item={item} t={t} locale={locale} />
        ))}
      </ol>
    </DashboardSection>
  );
}

function Item({ item, t, locale }: { item: ChecklistItem; t: WelcomeT; locale: string }) {
  const { title, body, link } = words(item, t, locale);
  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-3 px-5 py-4">
      {/* The words say whether it's done; the mark only backs them up. */}
      <span
        aria-hidden="true"
        className={`mt-0.5 inline-flex h-7 w-7 flex-none items-center justify-center rounded-full text-[15px] font-extrabold ${
          item.done ? "bg-ok text-on-ok" : "border-2 border-line text-ink-muted"
        }`}
      >
        {item.done ? "✓" : ""}
      </span>
      <div className="flex min-w-0 flex-[1_1_16rem] flex-col gap-1">
        <h3 className={`text-[17px] font-bold ${item.done ? "text-ink-muted" : ""}`}>
          {title}
          {item.done ? <span className="sr-only"> {t("doneLabel")}</span> : null}
        </h3>
        {item.done ? null : <p className="text-[15px] text-ink-muted">{body}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2 self-center">
        {item.done ? null : (
          // A plain anchor: PocketID's account page is another site.
          <a href={item.href} className="btn btn-secondary">
            {link}
          </a>
        )}
        {item.id === "backup-passkey" ? (
          <form action={tickChecklistItemAction.bind(null, item.id, !item.done)}>
            <button type="submit" className={item.done ? "text-sm font-semibold underline underline-offset-4" : "btn btn-primary"}>
              {item.done ? t("undo") : t("tick")}
            </button>
          </form>
        ) : null}
      </div>
    </li>
  );
}

function words(item: ChecklistItem, t: WelcomeT, locale: string) {
  if (item.id === "backup-passkey") {
    return { title: t("passkeyTitle"), body: t("passkeyBody"), link: t("passkeyLink") };
  }
  if (item.id === "request-app") {
    return { title: t("requestTitle"), body: t("requestBody"), link: t("requestLink") };
  }
  const neededBy = item.neededBy ?? [];
  return {
    title: t("prerequisiteTitle", { name: item.name ?? "" }),
    body: t("prerequisiteBody", {
      apps: new Intl.ListFormat(locale, { type: "conjunction" }).format(neededBy),
      count: neededBy.length,
    }),
    link: t("prerequisiteLink"),
  };
}
