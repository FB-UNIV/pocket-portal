import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getPocketIdConfig, listPocketIdGroups } from "@/lib/pocketid/client";
import { getTranslations } from "@/i18n/server";
import { createPostAction } from "../actions";
import { PostForm, problemMessage } from "../post-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("AdminNews");
  return { title: t("newTitle") };
}

export default async function NewPostPage({ searchParams }: PageProps<"/admin/news/new">) {
  await requireAdmin("/admin/news/new");
  const [groups, t, query] = await Promise.all([
    listPocketIdGroups(getPocketIdConfig()),
    getTranslations("AdminNews"),
    searchParams,
  ]);

  return (
    <main id="main-content" tabIndex={-1} className="flex flex-col gap-6">
      <Link href="/admin/news" className="text-sm font-semibold text-ink-muted underline-offset-4 hover:underline">
        {t("back")}
      </Link>
      <h1 className="text-3xl font-extrabold tracking-tight text-ink">{t("newTitle")}</h1>
      <PostForm action={createPostAction} groups={groups} problem={problemMessage(query?.problem, t)} t={t} />
    </main>
  );
}
