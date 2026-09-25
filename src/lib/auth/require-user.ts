import { redirect } from "next/navigation";
import { signInUrl } from "@/lib/auth/sign-in-redirect";
import { auth } from "@/auth";
import type { Session } from "next-auth";

// Server-only guard for any signed-in-only page/action. Mirrors
// requireAdmin() below, plus one extra check: a JWT session minted before
// session.user.id existed (src/lib/auth/callbacks.ts) won't have it, so
// this forces a fresh sign-in rather than letting a caller proceed with a
// missing requester identity.
export async function requireUser(returnTo?: string): Promise<Session> {
  const session = await auth();

  if (!session?.user) {
    redirect(signInUrl(returnTo));
  }

  if (!session.user.id) {
    redirect(signInUrl(returnTo));
  }

  return session;
}
