import type { Locale } from "@/i18n/locales";

const MONTHS: Record<Locale, readonly string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  // The usual French abbreviations; short months are written in full.
  fr: ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."],
};

// Deliberately not Intl.DateTimeFormat: this renders on the server, so the
// string would follow whatever CLDR data and TZ the container happens to
// ship (Node 24 already formats September as "Sept"), and an admin reading
// timestamps needs them to mean the same thing everywhere. Hence the month
// names are spelled out here per language too. Callers keep the
// machine-readable value in <time datetime>.
export function formatUtcTimestamp(date: Date, locale: Locale = "en"): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${pad(date.getUTCDate())} ${MONTHS[locale][date.getUTCMonth()]} ${date.getUTCFullYear()}, ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`
  );
}
