import Link from "next/link";
import { auth, signIn } from "@/auth";
import { getPortalName } from "@/lib/pocketid/branding";
import { safeCallbackUrl } from "@/lib/auth/sign-in-redirect";

// No `metadata` export: this page is the root layout's own segment, where
// `title.template` deliberately doesn't apply, so it takes the layout's
// `title.default` (the portal's name) rather than a suffixed one.
export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<{ callbackUrl?: string | string[] }>;
} = {}) {
  const [session, name, params] = await Promise.all([auth(), getPortalName(), searchParams]);
  // Where a signed-out visitor was headed (requireUser adds it); validated,
  // so the portal can't be used to bounce someone to another site.
  const redirectTo = safeCallbackUrl(params?.callbackUrl);

  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 dark:bg-black">
      <main
        id="main-content"
        tabIndex={-1}
        className="flex flex-1 w-full max-w-3xl flex-col items-center justify-center gap-6 py-24 px-6 sm:px-16 bg-white dark:bg-black"
      >
        <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
          {name}
        </h1>

        {session?.user ? (
          <div className="flex flex-col items-center gap-6 text-center">
            <p className="text-lg text-zinc-600 dark:text-zinc-400">
              Signed in as {session.user.name ?? session.user.email}
            </p>
            {/* The full nav (including the admin sections) lives in the site
                header now; these are the two entry points worth a landing-page
                call to action. */}
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/my-access"
                className="rounded-full bg-brand px-5 py-3 text-on-brand transition-colors hover:bg-brand-hover"
              >
                My Access
              </Link>
              <Link
                href="/apps"
                className="rounded-full border border-black/[.15] px-5 py-3 transition-colors hover:bg-zinc-100 dark:border-white/[.2] dark:hover:bg-zinc-900"
              >
                Browse apps
              </Link>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-6 text-center">
            <p className="max-w-prose text-zinc-600 dark:text-zinc-400">
              Sign in with your PocketID passkey to see the apps you can reach,
              and to request access to the ones you can&rsquo;t.
            </p>
            <form
              action={async () => {
                "use server";
                await signIn("pocketid", { redirectTo });
              }}
            >
              <button
                type="submit"
                className="rounded-full bg-brand px-5 py-3 text-on-brand transition-colors hover:bg-brand-hover"
              >
                Sign in with PocketID
              </button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
