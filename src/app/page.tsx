import Link from "next/link";
import type { ReactNode } from "react";
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

  // First name only, for a greeting that sounds like a person wrote it.
  const firstName = session?.user?.name?.trim().split(/\s+/)[0];

  if (session?.user) {
    return (
      <div className="flex flex-1 flex-col">
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 pt-8 pb-20"
        >
          <div className="flex flex-col gap-3">
            <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
              {firstName ? `Hi ${firstName}.` : "Hi there."} What would you like to do?
            </h1>
            <p className="text-ink-muted">
              Signed in as {session.user.name ?? session.user.email}
            </p>
          </div>

          {/* The full nav (including the admin sections) lives in the site
              header; these are the two entry points worth a landing-page
              call to action. Labelled by their titles alone, so the link
              names stay short and unambiguous. */}
          <ul className="grid gap-4 sm:grid-cols-2">
            <EntryCard
              href="/apps"
              id="entry-apps"
              title="Browse apps"
              body="Open the apps you use, and ask for the ones you don’t have yet."
              icon={<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />}
            />
            <EntryCard
              href="/my-access"
              id="entry-access"
              title="My Access"
              body="The groups you’re in. Handy when you’re asking an admin for something."
              icon={
                <>
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21a8 8 0 0 1 16 0" />
                </>
              }
            />
          </ul>
        </main>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-6xl flex-1 flex-wrap items-center gap-x-16 gap-y-12 px-6 py-16"
      >
        <div className="flex max-w-xl flex-[1_1_420px] flex-col gap-6">
          <h1 className="text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl">
            Welcome to {name}
          </h1>
          <p className="text-lg leading-relaxed text-ink-muted">
            One place for the apps we run. Sign in once, and everything you
            can use is a click away. Anything else, you can ask for.
          </p>
          <form
            className="flex flex-col items-start gap-3"
            action={async () => {
              "use server";
              await signIn("pocketid", { redirectTo });
            }}
          >
            <button type="submit" className="btn btn-primary min-h-14 px-7 text-[17px]">
              Sign in with PocketID
            </button>
            <p className="text-[15px] text-ink-muted">
              No password: your phone or computer unlocks it, like it does for
              your banking app.
            </p>
          </form>
          <p className="border-t border-line pt-5 text-[15px] text-ink-muted">
            <strong className="font-bold text-ink">First time?</strong> Use the
            invite link an admin sent you to set up your sign-in.
          </p>
        </div>

        <section aria-labelledby="how-h" className="flex flex-[1_1_340px] flex-col gap-4">
          <h2 id="how-h" className="text-sm font-bold uppercase tracking-wider text-ink-muted">
            How it works
          </h2>
          <ol className="flex flex-col gap-3">
            {[
              ["Sign in", "With your phone or computer. No password to remember."],
              ["Open what you need", "Each app says what it’s for. Click it and it opens."],
              ["Ask for the rest", "Missing something? Ask, and an admin lets you in."],
            ].map(([title, body], i) => (
              <li key={title} className="card flex items-start gap-4 p-5">
                <span
                  aria-hidden="true"
                  className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-surface-muted text-lg font-extrabold tabular-nums"
                >
                  {i + 1}
                </span>
                <span className="flex flex-col gap-1">
                  <span className="text-[17px] font-bold">{title}</span>
                  <span className="text-[15px] text-ink-muted">{body}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </div>
  );
}

function EntryCard({
  href,
  id,
  title,
  body,
  icon,
}: {
  href: string;
  id: string;
  title: string;
  body: string;
  icon: ReactNode;
}) {
  return (
    <li className="flex">
      <Link
        href={href}
        aria-labelledby={id}
        className="card card-link flex flex-1 items-start gap-5 p-6 text-ink"
      >
        <span
          aria-hidden="true"
          className="inline-flex h-14 w-14 flex-none items-center justify-center rounded-2xl bg-surface-muted"
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            {icon}
          </svg>
        </span>
        <span className="flex flex-col gap-1.5">
          <span id={id} className="text-xl font-bold tracking-tight">
            {title}
          </span>
          <span className="text-[15px] leading-relaxed text-ink-muted">{body}</span>
        </span>
      </Link>
    </li>
  );
}
