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
    <div className="flex flex-col flex-1 items-center">
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 pt-8 pb-20"
      >
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl text-ink">
          My Access
        </h1>
        {groups.length === 0 ? (
          <p className="text-ink-muted">
            You don&apos;t belong to any PocketID groups yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {groups.map((group) => (
              <li
                key={group}
                className="card px-4 py-3"
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
