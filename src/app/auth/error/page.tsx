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
    <div className="flex flex-col flex-1 items-center">
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 pt-8 pb-20"
      >
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl text-ink">
          Sign-in didn&rsquo;t work
        </h1>
        <p className="text-ink-muted">{message}</p>
        <Link
          href="/"
          className="self-start btn btn-primary"
        >
          Back to the sign-in page
        </Link>
      </main>
    </div>
  );
}
