import { Suspense } from "react";
import { auth, signIn } from "@/auth";
import { getPocketIdBranding, getPortalName } from "@/lib/pocketid/branding";
import { readSignInInviteHintEnabled, readSignInText } from "@/lib/config";
import { safeCallbackUrl } from "@/lib/auth/sign-in-redirect";
import { getLocale, getTranslations } from "@/i18n/server";
import { YourApps, YourAppsLoading } from "./_dashboard/your-apps";
import { WelcomeChecklist } from "./_dashboard/welcome";

// No `metadata` export: this page is the root layout's own segment, where
// `title.template` deliberately doesn't apply, so it takes the layout's
// `title.default` (the portal's name) rather than a suffixed one.
export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<{ callbackUrl?: string | string[] }>;
} = {}) {
  // Branding is fetched once per render (React cache), so asking for it
  // here costs nothing beyond what the root layout already did.
  const [session, name, params, tSignIn, tHome, branding, locale] = await Promise.all([
    auth(),
    getPortalName(),
    searchParams,
    getTranslations("SignIn"),
    getTranslations("Home"),
    getPocketIdBranding(),
    getLocale(),
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

          {/* The dashboard, top to bottom: the onboarding checklist (#21),
              your apps, news (#22), integration widgets (#23). Each section
              is its own <Suspense> and follows _dashboard/section.tsx, so
              one slow or broken source never blanks the page (see
              docs/ARCHITECTURE.md, "The dashboard"). */}
          {/* Nothing while it loads: it appears once it's ready, and only
              while something's left to do. */}
          <Suspense fallback={null}>
            <WelcomeChecklist userId={session.user.id} userGroups={session.user.groups} />
          </Suspense>
          <Suspense fallback={<YourAppsLoading />}>
            <YourApps userGroups={session.user.groups} />
          </Suspense>
        </main>
      </div>
    );
  }

  const custom = readSignInText(locale);

  const background = branding?.background;

  // The sign-in page is the button (sign-in redesign): a short headline and
  // one line above it, a picture beside it, and nothing else to read. The
  // picture takes most of a wide screen; on a phone, as on PocketID's own
  // login page, it covers the whole screen behind a solid card.
  return (
    <div className="flex flex-1 flex-col">
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-12 px-6 pt-6 pb-12 lg:flex-row lg:items-stretch"
      >
        <div
          className={`flex flex-col items-center justify-center gap-10 text-center lg:min-w-[400px] lg:grow-[2] lg:basis-0 lg:py-6 ${
            background
              ? "my-auto rounded-[32px] bg-ground px-3 py-10 shadow-[0_24px_48px_-12px_rgb(0_0_0/0.45)] lg:my-0 lg:rounded-none lg:bg-transparent lg:px-0 lg:shadow-none"
              : "py-6"
          }`}
        >
          <div className="flex flex-col gap-3">
            <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-[44px]">
              {custom.headline ?? tSignIn("title", { name })}
            </h1>
            <p className="text-lg text-ink-muted">{custom.tagline ?? tSignIn("tagline")}</p>
          </div>

          <form
            className="w-full max-w-[440px] rounded-full bg-brand/12 p-2.5"
            action={async () => {
              "use server";
              await signIn("pocketid", { redirectTo });
            }}
          >
            {/* The visible label is the whole accessible name (SC 2.5.3);
                the key and the arrow are decoration. */}
            <button
              type="submit"
              className="group flex min-h-20 w-full cursor-pointer items-center gap-3 rounded-full bg-brand py-0 pr-5 pl-3 text-left text-on-brand shadow-[0_2px_4px_rgb(31_27_22/0.12),0_28px_48px_-18px_rgb(31_27_22/0.55)] transition-[background-color,transform] duration-150 ease-out hover:bg-brand-hover active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 sm:min-h-24 sm:gap-5 sm:pr-9 sm:pl-4 xl:min-h-28"
            >
              <span
                aria-hidden="true"
                className="inline-flex h-14 w-14 flex-none items-center justify-center rounded-full bg-surface text-brand sm:h-16 sm:w-16 xl:h-20 xl:w-20"
              >
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="8" cy="15" r="4" />
                  <path d="m10.85 12.15 8.65-8.65M18 5l2 2M15 8l2 2" />
                </svg>
              </span>
              <span className="flex-1 text-[22px] font-extrabold tracking-tight whitespace-nowrap sm:text-[28px] xl:text-[32px]">
                {tSignIn("button")}
              </span>
              <svg aria-hidden="true" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="hidden h-7 w-7 flex-none min-[360px]:block sm:h-8 sm:w-8 transition-transform duration-150 group-hover:translate-x-1 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          </form>

          {readSignInInviteHintEnabled() && (
            <p className="text-sm text-ink-muted">
              {tSignIn("firstTimeLead")}{" "}
              <span className="font-semibold text-ink">{tSignIn("firstTimeBody")}</span>
            </p>
          )}
        </div>

        <div
          className={`overflow-hidden bg-brand lg:relative lg:flex lg:min-h-[640px] lg:grow-[3] lg:basis-0 lg:rounded-[32px] ${
            background ? "fixed inset-0 -z-10 lg:inset-auto lg:z-auto" : "relative flex min-h-64 rounded-[32px]"
          }`}
        >
          {background ? (
            // PocketID's login background. Decorative, and a plain <img> as
            // with the header logo: next/image would need PocketID's host in
            // remotePatterns. An untouched PocketID serves its stock image.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={background}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <SignInTiles />
          )}
        </div>
      </main>
    </div>
  );
}

// The sign-in picture when PocketID's branding is off or unreachable: tiles
// in the portal's app-mark tints around its house, standing for "your apps
// in one place". No app names: the visitor isn't signed in yet.
const TILES: Array<{ tint: string | null; tilt: string }> = [
  { tint: "#ECE6FB", tilt: "-rotate-3" },
  { tint: null, tilt: "" },
  { tint: "#FBEBD3", tilt: "rotate-2" },
  { tint: null, tilt: "" },
  { tint: "house", tilt: "" },
  { tint: "#DFEDF9", tilt: "-rotate-2" },
  { tint: "#DCF1E8", tilt: "rotate-3" },
  { tint: null, tilt: "" },
  { tint: "#F8E4DA", tilt: "-rotate-3" },
];

function SignInTiles() {
  return (
    <div aria-hidden="true" className="grid flex-1 grid-cols-3 content-center gap-4 p-8 sm:gap-5 sm:p-12">
      {TILES.map(({ tint, tilt }, i) =>
        tint === "house" ? (
          <span key={i} className="flex aspect-square items-center justify-center rounded-[28px] bg-surface text-brand">
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 10.5 12 3l9 7.5" />
              <path d="M5 9.5V21h14V9.5" />
              <path d="M10 21v-6h4v6" />
            </svg>
          </span>
        ) : (
          <span
            key={i}
            style={tint ? { background: tint } : undefined}
            className={`aspect-square rounded-[28px] ${tint ? tilt : "bg-white/15"}`}
          />
        ),
      )}
    </div>
  );
}
