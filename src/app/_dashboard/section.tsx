import Link from "next/link";
import type { ReactNode } from "react";
import { logger } from "@/lib/observability/logger";

// The contract every dashboard section follows (#20). Each section:
//
// - renders inside its own <Suspense> on `/`, with a loading state built
//   from DashboardSection (busy), so a slow source never holds up the page;
// - loads through loadSection(), so a failing source (PocketID, the
//   database, an integration) costs that one section an error card, never
//   the whole dashboard;
// - keeps the same landmark and heading whether loading, loaded or failed,
//   so the page doesn't jump and screen-reader users find it in the same
//   place every time.
//
// See docs/ARCHITECTURE.md, "The dashboard".

export function DashboardSection({
  id,
  heading,
  action,
  busy,
  children,
}: {
  /** Unique on the page: the heading's id is derived from it. */
  id: string;
  heading: string;
  /** A link or two beside the heading (e.g. "See all apps"). */
  action?: ReactNode;
  busy?: boolean;
  children: ReactNode;
}) {
  const headingId = `${id}-h`;
  return (
    // data-tour: what the guided tour (lib/onboarding/tour.ts) points at.
    <section
      aria-labelledby={headingId}
      aria-busy={busy || undefined}
      data-tour={id}
      className="flex flex-col gap-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 id={headingId} className="text-2xl font-bold tracking-tight">
          {heading}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// What a section shows in place of its content when it failed to load.
// "Try again" reloads the dashboard: sections are server-rendered, so
// that's the retry.
export function SectionError({
  title,
  detail,
  tryAgain,
}: {
  title: string;
  detail: string;
  tryAgain: string;
}) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-2xl border border-bad-line bg-bad px-5 py-4 text-on-bad">
      <p className="text-[15px] font-bold">{title}</p>
      <p className="text-sm">
        {detail}{" "}
        <Link href="/" className="font-semibold underline underline-offset-4">
          {tryAgain}
        </Link>
      </p>
    </div>
  );
}

export type SectionLoad<T> = { ok: true; value: T } | { ok: false };

// Runs a section's loader and turns any failure, including one thrown
// before a promise exists, into a result the section renders as an error
// card. Logged with the section's name, since the page itself succeeds.
export async function loadSection<T>(name: string, load: () => Promise<T>): Promise<SectionLoad<T>> {
  try {
    return { ok: true, value: await load() };
  } catch (err) {
    logger.error({ err }, `Dashboard: ${name} failed to load`);
    return { ok: false };
  }
}
