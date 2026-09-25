import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { signInUrl } from "@/lib/auth/sign-in-redirect";

export const metadata: Metadata = {
  title: "My Access",
};

// Shows the signed-in user's raw PocketID group memberships — the groups
// themselves, not the apps they unlock. /apps is the app-centric view and
// already cross-references the catalog, so this page stays deliberately
// literal: it answers "what am I a member of", which is what a user needs
// when asking an admin for access.
export default async function MyAccessPage() {
  const session = await auth();

  if (!session?.user) {
    redirect(signInUrl("/my-access"));
  }

  const groups = session.user.groups;

  return (
    <div className="flex flex-col flex-1 items-center bg-zinc-50 dark:bg-black">
      <main
        id="main-content"
        tabIndex={-1}
        className="flex w-full max-w-3xl flex-col gap-6 py-16 px-6 sm:px-16 bg-white dark:bg-black"
      >
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          My Access
        </h1>
        {groups.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">
            You don&apos;t belong to any PocketID groups yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {groups.map((group) => (
              <li
                key={group}
                className="rounded-lg border border-black/[.08] px-4 py-3 dark:border-white/[.145]"
              >
                {group}
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
