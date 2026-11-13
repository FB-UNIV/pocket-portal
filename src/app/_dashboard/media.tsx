import { getDb } from "@/lib/db/client";
import { getPocketIdConfig } from "@/lib/pocketid/client";
import { listUserCatalogApps } from "@/lib/catalog/apps";
import { getIntegration } from "@/lib/integrations/store";
import { cached } from "@/lib/integrations/cache";
import { createJellyfin } from "@/lib/integrations/jellyfin";
import { readJellyfinApiKey } from "@/lib/config";
import { getTranslations } from "@/i18n/server";
import { DashboardSection, SectionError, loadSection } from "./section";

const SECTION_ID = "media";
const SHOWN = 8;

// "New on Jellyfin" (#23): the newest films and episodes, read on the
// server (the key never reaches the browser), only for people who can open
// the app it's linked to. Posters come through the portal
// (/api/integrations/jellyfin/posters), so the browser never talks to
// Jellyfin. Off, unset, or no key: nothing. Jellyfin slow or down: its own
// card says so, never the dashboard (#20's contract).
export async function MediaWidget({ userGroups }: { userGroups: string[] }) {
  const apiKey = readJellyfinApiKey();
  if (!apiKey) return null;

  const setup = await loadSection("Integrations", async () => {
    const db = getDb();
    const [settings, apps] = await Promise.all([
      getIntegration(db, "jellyfin"),
      listUserCatalogApps(getPocketIdConfig(), db, userGroups),
    ]);
    return { settings, app: apps.find((a) => a.id === settings?.linkedClientId) };
  });
  if (!setup.ok) return null;
  const { settings, app } = setup.value;
  if (!settings?.enabled || !app?.hasAccess) return null;

  const t = await getTranslations("Media");
  const heading = t("heading", { app: app.name });
  const jellyfin = createJellyfin({ baseUrl: settings.baseUrl, apiKey });
  // A minute's memory per replica: the dashboard is opened often, new
  // films arrive rarely.
  const items = await loadSection("Jellyfin", () =>
    cached(`jellyfin:${settings.baseUrl}:recent`, 60_000, () => jellyfin.recentlyAdded(SHOWN)),
  );

  if (!items.ok) {
    return (
      <DashboardSection id={SECTION_ID} heading={heading}>
        <SectionError title={t("unavailable", { app: app.name })} detail={t("unavailableDetail")} tryAgain={t("tryAgain")} />
      </DashboardSection>
    );
  }
  if (items.value.length === 0) return null;

  return (
    <DashboardSection id={SECTION_ID} heading={heading}>
      <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,150px),1fr))]">
        {items.value.map((item) => (
          <li key={item.id} className="flex">
            <a href={jellyfin.itemUrl(item)} rel="noreferrer" className="card card-link flex flex-1 flex-col gap-2 p-2 text-ink">
              {item.hasPoster ? (
                // Decorative: the title names the link. Relayed by the portal.
                // eslint-disable-next-line @next/next/no-img-element -- next/image is off (no sharp); see next.config.ts
                <img
                  src={`/api/integrations/jellyfin/posters/${item.id}`}
                  alt=""
                  loading="lazy"
                  className="aspect-[2/3] w-full rounded-lg bg-surface-muted object-cover"
                />
              ) : (
                <span aria-hidden="true" className="aspect-[2/3] w-full rounded-lg bg-surface-muted" />
              )}
              <span className="px-1 text-[15px] leading-tight font-bold">{item.title}</span>{" "}
              {item.subtitle ? <span className="px-1 pb-1 text-sm text-ink-muted">{item.subtitle}</span> : null}
            </a>
          </li>
        ))}
      </ul>
    </DashboardSection>
  );
}
