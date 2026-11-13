import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/require-user";
import { getDb } from "@/lib/db/client";
import { listPostsFor } from "@/lib/news/store";
import { getLocale, getTranslations } from "@/i18n/server";
import { NewsArticle } from "@/app/_dashboard/news";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("News");
  return { title: t("heading") };
}

// All the news this person may see (#22): the dashboard shows the latest
// five and links here. Filtered on the server, like the dashboard.
export default async function NewsPage() {
  const session = await requireUser("/news");
  const [posts, t, locale] = await Promise.all([
    listPostsFor(getDb(), session.user.groups, new Date()),
    getTranslations("News"),
    getLocale(),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <main id="main-content" tabIndex={-1} className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 pt-8 pb-20">
        <h1 className="text-4xl font-extrabold tracking-tight">{t("heading")}</h1>
        {posts.length === 0 ? (
          <p className="text-ink-muted">{t("none")}</p>
        ) : (
          posts.map((post) => <NewsArticle key={post.id} post={post} t={t} locale={locale} />)
        )}
      </main>
    </div>
  );
}
