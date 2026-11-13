import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { getPocketIdConfig } from "@/lib/pocketid/client";
import { listUserCatalogApps } from "@/lib/catalog/apps";
import { readAccessRequestsEnabled } from "@/lib/config";
import { AppMark } from "@/app/_components/app-mark";
import { getTranslations } from "@/i18n/server";
import { DashboardSection, SectionError, loadSection } from "./section";

const SECTION_ID = "your-apps";

export async function YourAppsLoading() {
  const t = await getTranslations("YourApps");
  return (
    <DashboardSection id={SECTION_ID} heading={t("heading")} busy>
      <p className="text-ink-muted">{t("loading")}</p>
    </DashboardSection>
  );
}

// Quick launchers for the apps the user can already open. Browsing, search
// and asking for more stay on /apps; this is the "get straight to it" view.
//
// A dashboard section (./section): its own <Suspense> on `/`, and a slow or
// failing PocketID costs this one section an error card, not the page (#20).
export async function YourApps({ userGroups }: { userGroups: string[] }) {
  const requestsEnabled = readAccessRequestsEnabled();
  const t = await getTranslations("YourApps");
  const heading = t("heading");

  const loaded = await loadSection("Your apps", () =>
    listUserCatalogApps(getPocketIdConfig(), getDb(), userGroups),
  );
  if (!loaded.ok) {
    return (
      <DashboardSection id={SECTION_ID} heading={heading}>
        <SectionError title={t("loadError")} detail={t("loadErrorDetail")} tryAgain={t("tryAgain")} />
      </DashboardSection>
    );
  }

  const usable = loaded.value.filter((app) => app.hasAccess);

  if (usable.length === 0) {
    return (
      <DashboardSection id={SECTION_ID} heading={heading}>
        <div className="card flex flex-col items-start gap-3 p-6">
          <p className="text-[17px] font-bold">{t("emptyTitle")}</p>
          {requestsEnabled ? (
            <>
              <p className="text-[15px] text-ink-muted">{t("emptyAskBody")}</p>
              <Link href="/apps" className="btn btn-primary">
                {t("emptyAskButton")}
              </Link>
            </>
          ) : (
            <p className="text-[15px] text-ink-muted">{t("emptyAskAdmin")}</p>
          )}
        </div>
      </DashboardSection>
    );
  }

  return (
    <DashboardSection
      id={SECTION_ID}
      heading={heading}
      action={
        <Link href="/apps" className="text-[15px] font-semibold text-ink underline underline-offset-4">
          {requestsEnabled ? t("seeAllOrAsk") : t("seeAll")}
        </Link>
      }
    >
      <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,240px),1fr))]">
        {usable.map((app) => (
          <li key={app.id} className="flex">
            {/* The card's own words are its accessible name (the app, then
                what it's for), so the name says where the link goes (SC
                2.4.4) and contains everything the card shows (SC 2.5.3,
                label in name: a voice user says what they see). The space
                between the spans keeps the two apart in that name. */}
            <a
              href={app.launchUrl}
              className="card card-link flex flex-1 items-center gap-3.5 p-4 text-ink"
            >
              <AppMark name={app.name} iconUrl={app.iconUrl} size="sm" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[17px] font-bold tracking-tight">{app.name}</span>{" "}
                {app.description && (
                  <span className="line-clamp-2 text-sm text-ink-muted">{app.description}</span>
                )}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </DashboardSection>
  );
}
