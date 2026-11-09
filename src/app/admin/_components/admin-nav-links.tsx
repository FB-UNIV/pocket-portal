"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type AdminNavItem = {
  href: string;
  label: string;
  // Shown beside the label (pending requests). Omitted, or 0, shows nothing.
  count?: number;
};

// The admin side menu's links. A client component only for usePathname,
// so the current page is marked with aria-current rather than colour alone.
export function AdminNavLinks({ items }: { items: AdminNavItem[] }) {
  const pathname = usePathname();

  return (
    <ul className="flex gap-1 overflow-x-auto lg:flex-col">
      {items.map((item) => {
        const current = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <li key={item.href} className="shrink-0">
            <Link
              href={item.href}
              aria-current={current ? "page" : undefined}
              className="flex min-h-11 items-center justify-between gap-3 rounded-full px-4 text-[15px] font-semibold text-ink-muted no-underline transition-colors hover:bg-surface-muted hover:text-ink aria-[current=page]:bg-ink aria-[current=page]:text-ground"
            >
              {item.label}
              {item.count ? (
                <>
                  {/* A bare "3" read after the label means little; the link's
                      name says "Requests, 3 waiting" instead. */}
                  <span className="sr-only">, {item.count} waiting</span>
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
