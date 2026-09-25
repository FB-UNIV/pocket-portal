const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Deliberately not Intl.DateTimeFormat: this renders on the server, so the
// string would follow whatever CLDR data and TZ the container happens to
// ship (Node 24 already formats September as "Sept"), and an admin reading
// timestamps needs them to mean the same thing everywhere. Callers keep the
// machine-readable value in <time datetime>.
export function formatUtcTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${pad(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}, ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`
  );
}
