// Whether an admin's header offers the Access Requests queue. Always,
// while requests are on. Switched off, only while something filed before is
// still pending, so it can be drained without advertising a dead page.
export async function showAccessRequestsLink(
  requestsEnabled: boolean,
  hasPending: () => Promise<boolean>,
): Promise<boolean> {
  if (requestsEnabled) return true;
  try {
    return await hasPending();
  } catch {
    // A nav link isn't worth failing every page over; the page itself works.
    return true;
  }
}
