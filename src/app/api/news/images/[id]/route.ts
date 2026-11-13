import { auth } from "@/auth";
import { getDb } from "@/lib/db/client";
import { getImage } from "@/lib/news/image-store";
import { isVisibleTo } from "@/lib/news/posts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const notFound = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

// A news post's picture (#22), to people who may read the post: signed in,
// and the post is for them (admins see every post's, for the editor). A
// 404 otherwise, so a picture's existence says nothing.
//
// Served inert: the stored type (sniffed and stripped at upload), nosniff
// so the browser never second-guesses it, and a sandboxing CSP should one
// ever be opened directly. Immutable by id, but private: it's behind sign-in.
export async function GET(_request: Request, { params }: RouteContext<"/api/news/images/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) return notFound();

  const session = await auth();
  if (!session?.user) return notFound();

  const image = await getImage(getDb(), id);
  if (!image) return notFound();
  const { groups = [], isAdmin = false } = session.user as { groups?: string[]; isAdmin?: boolean };
  if (!isAdmin && !isVisibleTo(image.post, groups, new Date())) return notFound();

  return new Response(new Uint8Array(image.bytes), {
    headers: {
      "Content-Type": image.contentType,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
