import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getDb } from "@/lib/db/client";
import { getPocketIdConfig, listPocketIdGroups } from "@/lib/pocketid/client";
import { getPost } from "@/lib/news/store";
import { listImages } from "@/lib/news/image-store";
import { getLocale, getTranslations } from "@/i18n/server";
import { NewsArticle } from "@/app/_dashboard/news";
import { deleteImageAction, deletePostAction, setCoverAction, updatePostAction, uploadImageAction } from "../actions";
import { PostForm, problemMessage } from "../post-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("AdminNews");
  return { title: t("editTitle") };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One post: edit it, see it as people will, or delete it (#22).
export default async function EditPostPage({ params, searchParams }: PageProps<"/admin/news/[id]">) {
  const { id } = await params;
  await requireAdmin(`/admin/news/${encodeURIComponent(id)}`);
  // A malformed id would reach Postgres as a bad uuid.
  if (!UUID.test(id)) notFound();

  const [post, images, groups, t, tNews, locale, query] = await Promise.all([
    getPost(getDb(), id),
    listImages(getDb(), id),
    listPocketIdGroups(getPocketIdConfig()),
    getTranslations("AdminNews"),
    getTranslations("News"),
    getLocale(),
    searchParams,
  ]);
  if (!post) notFound();

  return (
    <main id="main-content" tabIndex={-1} className="flex flex-col gap-6">
      <Link href="/admin/news" className="text-sm font-semibold text-ink-muted underline-offset-4 hover:underline">
        {t("back")}
      </Link>
      <h1 className="text-3xl font-extrabold tracking-tight text-ink break-words">{post.title}</h1>
      {query?.saved ? (
        <p role="status" className="badge badge-ok self-start">
          {t("saved")}
        </p>
      ) : null}
      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[1_1_28rem] flex-col gap-4">
          <PostForm
            action={updatePostAction.bind(null, post.id)}
            post={post}
            groups={groups}
            problem={problemMessage(query?.problem, t)}
            t={t}
          />
          <section aria-labelledby="pictures-h" className="card flex flex-col gap-4 p-6">
            <div className="flex flex-col gap-1">
              <h2 id="pictures-h" className="text-lg font-bold">
                {t("picturesHeading")}
              </h2>
              <p className="text-sm text-ink-muted">{t("picturesHint")}</p>
            </div>
            {query?.picture === "added" ? (
              <p role="status" className="badge badge-ok self-start">
                {t("pictureAdded")}
              </p>
            ) : null}
            <form action={uploadImageAction.bind(null, post.id)} className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="picture" className="text-sm font-semibold">
                  {t("pictureLabel")}
                </label>
                <input id="picture" name="picture" type="file" required accept="image/png,image/jpeg,image/webp,image/gif" />
              </div>
              <button type="submit" className="btn btn-secondary">
                {t("upload")}
              </button>
            </form>
            {images.length > 0 ? (
              <ul className="flex flex-col divide-y divide-line">
                {images.map((image, i) => {
                  const src = `/api/news/images/${image.id}`;
                  const cover = post.coverImageId === image.id;
                  return (
                    <li key={image.id} className="flex flex-wrap items-center gap-4 py-3">
                      {/* eslint-disable-next-line @next/next/no-img-element -- next/image is off (no sharp); see next.config.ts */}
                      <img src={src} alt={t("pictureNumber", { n: images.length - i })} className="h-16 w-24 rounded-lg object-cover" />
                      <div className="flex min-w-0 flex-[1_1_12rem] flex-col gap-1 text-sm">
                        <span className="text-ink-muted">{t("pictureInPost")}</span>
                        <code className="rounded bg-surface-muted px-1 break-all">{`![](${src})`}</code>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <form action={setCoverAction.bind(null, post.id, cover ? null : image.id)}>
                          <button type="submit" className="btn btn-secondary">
                            {cover ? t("removeCover") : t("useAsCover")}
                          </button>
                        </form>
                        <form action={deleteImageAction.bind(null, post.id, image.id)}>
                          <button type="submit" className="btn btn-quiet">
                            {t("deletePicture")}
                          </button>
                        </form>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>
          <form action={deletePostAction.bind(null, post.id)}>
            <button type="submit" className="btn btn-secondary">
              {t("delete")}
            </button>
          </form>
        </div>
        <aside aria-labelledby="preview-h" className="flex flex-[0_1_24rem] flex-col gap-3 max-lg:basis-full">
          <h2 id="preview-h" className="text-sm font-bold tracking-wide text-ink-muted uppercase">
            {t("preview")}
          </h2>
          <NewsArticle post={post} t={tNews} locale={locale} />
        </aside>
      </div>
    </main>
  );
}
