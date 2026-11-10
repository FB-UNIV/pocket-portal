"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type AdminNavItem = {
  href: string;
  label: string;
  // Shown beside the label (pending requests). Omitted, or 0, shows nothing.
  count?: number;
  // What a screen reader hears after the label instead of the bare number
  // (", 3 waiting"), already translated.
  countLabel?: string;
};

// The admin tabs' links. A client component only for usePathname,
// so the current page is marked with aria-current rather than colour alone.
export function AdminNavLinks({ items }: { items: AdminNavItem[] }) {
  const pathname = usePathname();

  return (
    <ul className="flex gap-1 overflow-x-auto rounded-full bg-surface-muted p-1">
      {items.map((item) => {
        const current = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <li key={item.href} className="shrink-0">
            <Link
              href={item.href}
              aria-current={current ? "page" : undefined}
              className="flex min-h-11 items-center gap-2 rounded-full px-4 text-[15px] font-semibold text-ink-muted no-underline transition-colors hover:text-ink aria-[current=page]:bg-ink aria-[current=page]:text-ground sm:px-5"
            >
              {item.label}
              {item.count ? (
                <>
                  {/* A bare "3" read after the label means little; the link's
                      name says "Requests, 3 waiting" instead. */}
                  <span className="sr-only">{item.countLabel ?? `, ${item.count}`}</span>
                  <span
                    aria-hidden="true"
                    className="min-w-6 rounded-full bg-brand px-1.5 text-center text-xs leading-6 font-bold text-on-brand tabular-nums"
                  >
                    {item.count}
                  </span>
                </>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
