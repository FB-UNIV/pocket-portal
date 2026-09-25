import { redirect } from "next/navigation";
import { auth } from "@/auth";
import type { Session } from "next-auth";

// Server-only guard for admin-gated pages and server actions. Redirects
// unauthenticated visitors to sign-in, and signed-in non-admins to home —
// next/navigation's forbidden() would be the more precise 403, but it's
// gated behind the experimental `authInterrupts` config flag, not worth
// enabling for this.
export async function requireAdmin(): Promise<Session> {
  const session = await auth();

  if (!session?.user) {
    redirect("/api/auth/signin/pocketid");
  }

  if (!session.user.isAdmin) {
    redirect("/");
  }

  return session;
}
