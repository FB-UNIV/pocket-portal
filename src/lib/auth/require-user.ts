import { redirect } from "next/navigation";
import { auth } from "@/auth";
import type { Session } from "next-auth";

// Server-only guard for any signed-in-only page/action. Mirrors
// requireAdmin() below, plus one extra check: a JWT session minted before
// session.user.id existed (src/lib/auth/callbacks.ts) won't have it, so
// this forces a fresh sign-in rather than letting a caller proceed with a
// missing requester identity.
export async function requireUser(): Promise<Session> {
  const session = await auth();

  if (!session?.user) {
    redirect("/api/auth/signin/pocketid");
  }

  if (!session.user.id) {
    redirect("/api/auth/signin/pocketid");
  }

  return session;
}
