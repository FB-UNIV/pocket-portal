import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Sign-in problem",
};

// Auth.js sends sign-in failures here (pages.error in src/auth.ts) instead
// of its own unstyled page. The error code only selects a message: it's
// never rendered, so the query string can't put text on the page.
const MESSAGES: Record<string, string> = {
  Configuration:
    "There's a problem with the portal's setup, so it couldn't sign you in. If you run this portal, its logs say what went wrong.",
  AccessDenied: "PocketID didn't let you sign in to this portal. Ask an admin if you think you should have access.",
  Verification: "That sign-in link has expired or was already used. Start again from the sign-in page.",
};

const FALLBACK = "Something went wrong while signing you in. Try again from the sign-in page.";

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { error } = await searchParams;
  const message = (typeof error === "string" && Object.hasOwn(MESSAGES, error) && MESSAGES[error]) || FALLBACK;

  return (
    <div className="flex flex-col flex-1 items-center bg-zinc-50 dark:bg-black">
      <main
        id="main-content"
        tabIndex={-1}
        className="flex w-full max-w-3xl flex-col gap-6 py-16 px-6 sm:px-16 bg-white dark:bg-black"
      >
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Sign-in didn&rsquo;t work
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">{message}</p>
        <Link
          href="/"
          className="self-start rounded-full bg-brand px-4 py-2 text-sm text-on-brand transition-colors hover:bg-brand-hover"
        >
          Back to the sign-in page
        </Link>
      </main>
    </div>
  );
}
