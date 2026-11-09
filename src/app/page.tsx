import { Suspense } from "react";
import { auth, signIn } from "@/auth";
import { getPortalName } from "@/lib/pocketid/branding";
import { safeCallbackUrl } from "@/lib/auth/sign-in-redirect";
import { getTranslations } from "@/i18n/server";
import { YourApps, YourAppsLoading } from "./_dashboard/your-apps";

// No `metadata` export: this page is the root layout's own segment, where
// `title.template` deliberately doesn't apply, so it takes the layout's
// `title.default` (the portal's name) rather than a suffixed one.
export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<{ callbackUrl?: string | string[] }>;
} = {}) {
  const [session, name, params, tSignIn, tHome] = await Promise.all([
    auth(),
    getPortalName(),
    searchParams,
    getTranslations("SignIn"),
    getTranslations("Home"),
  ]);
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
              {/* "__none" picks the greeting without a name. */}
              {tHome("greeting", { name: firstName ?? "__none" })}
            </h1>
            <p className="text-ink-muted">
              {tHome("signedInAs", { name: session.user.name ?? session.user.email ?? "" })}
            </p>
          </div>

          {/* The dashboard (#20), top to bottom: the onboarding checklist
              (#21), your apps, news (#22), integration widgets (#23). Only
              "Your apps" exists so far; the others slot in here as they
              land, each in its own <Suspense> and handling its own
              failure, so one slow or broken source never blanks the page. */}
          <Suspense fallback={<YourAppsLoading />}>
            <YourApps userGroups={session.user.groups} />
          </Suspense>
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
            {tSignIn("title", { name })}
          </h1>
          <p className="text-lg leading-relaxed text-ink-muted">{tSignIn("intro")}</p>
          <form
            className="flex flex-col items-start gap-3"
            action={async () => {
              "use server";
              await signIn("pocketid", { redirectTo });
            }}
          >
            <button type="submit" className="btn btn-primary min-h-14 px-7 text-[17px]">
              {tSignIn("button")}
            </button>
            <p className="text-[15px] text-ink-muted">{tSignIn("passkeyHint")}</p>
          </form>
          <p className="border-t border-line pt-5 text-[15px] text-ink-muted">
            <strong className="font-bold text-ink">{tSignIn("firstTimeLead")}</strong>{" "}
            {tSignIn("firstTimeBody")}
          </p>
        </div>

        <section aria-labelledby="how-h" className="flex flex-[1_1_340px] flex-col gap-4">
          <h2 id="how-h" className="text-sm font-bold uppercase tracking-wider text-ink-muted">
            {tSignIn("howItWorks")}
          </h2>
          <ol className="flex flex-col gap-3">
            {[
              [tSignIn("step1Title"), tSignIn("step1Body")],
              [tSignIn("step2Title"), tSignIn("step2Body")],
              [tSignIn("step3Title"), tSignIn("step3Body")],
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
