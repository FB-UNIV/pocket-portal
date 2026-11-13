import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getDb } from "@/lib/db/client";
import { listAllPosts } from "@/lib/news/store";
import { getLocale, getTranslations } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("AdminNews");
  return { title: t("title") };
}

// Every post (#22), newest first, each saying who sees it and whether it's
// still up. Expired posts stay listed, so they can be shown again.
export default async function AdminNewsPage() {
  await requireAdmin("/admin/news");
  const [posts, t, locale] = await Promise.all([listAllPosts(getDb()), getTranslations("AdminNews"), getLocale()]);
  const now = new Date();
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });

  return (
    <main id="main-content" tabIndex={-1} className="flex flex-col gap-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-4xl font-extrabold tracking-tight text-ink">{t("title")}</h1>
        <Link href="/admin/news/new" className="btn btn-primary">
          {t("new")}
        </Link>
      </div>
      {posts.length === 0 ? (
        <p className="card p-6 text-ink-muted">{t("none")}</p>
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {posts.map((post) => {
            const expired = post.expiresAt !== null && post.expiresAt <= now;
            return (
              <li key={post.id} className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 px-5 py-4">
                <div className="flex min-w-0 flex-col">
                  <Link href={`/admin/news/${post.id}`} className="text-[17px] font-bold underline-offset-4 hover:underline">
                    {post.title}
                  </Link>
                  <p className="text-sm text-ink-muted">
                    {date.format(post.publishedAt)} ·{" "}
                    {post.audienceGroups.length === 0
                      ? t("forEveryone")
                      : t("forGroups", { groups: post.audienceGroups.join(", ") })}
                  </p>
                </div>
                <p className="flex gap-2 text-sm">
                  {post.pinned ? <span className="badge badge-tip">{t("pinned")}</span> : null}
                  {expired ? <span className="badge">{t("expired")}</span> : null}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
