import { auth } from "@/auth";
import { getDb } from "@/lib/db/client";
import { getPocketIdConfig } from "@/lib/pocketid/client";
import { listUserCatalogApps } from "@/lib/catalog/apps";
import { getIntegration } from "@/lib/integrations/store";
import { createJellyfin, isItemId } from "@/lib/integrations/jellyfin";
import { readJellyfinApiKey } from "@/lib/config";

const notFound = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

// A Jellyfin poster, relayed (#23): the browser never talks to Jellyfin,
// and only people who can open the app Jellyfin is linked to get one. The
// item id is checked before Jellyfin is asked anything, and only a picture
// is relayed (lib/integrations/jellyfin), served inert like news pictures.
export async function GET(_request: Request, { params }: RouteContext<"/api/integrations/jellyfin/posters/[itemId]">) {
  const { itemId } = await params;
  if (!isItemId(itemId)) return notFound();

  const session = await auth();
  const apiKey = readJellyfinApiKey();
  if (!session?.user || !apiKey) return notFound();

  const db = getDb();
  const settings = await getIntegration(db, "jellyfin");
  if (!settings?.enabled) return notFound();
  const groups = (session.user as { groups?: string[] }).groups ?? [];
  const apps = await listUserCatalogApps(getPocketIdConfig(), db, groups);
  if (!apps.find((a) => a.id === settings.linkedClientId)?.hasAccess) return notFound();

  const poster = await createJellyfin({ baseUrl: settings.baseUrl, apiKey }).poster(itemId);
  if (!poster) return notFound();

  return new Response(new Uint8Array(poster.bytes), {
    headers: {
      "Content-Type": poster.contentType,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, max-age=86400",
    },
  });
}
