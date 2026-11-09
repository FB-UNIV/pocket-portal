// Warm tints for apps without a PocketID logo, picked by name so an app
// keeps its colour between visits. Ink on each is >= 7:1.
const TINTS = ["#ECE6FB", "#FBEBD3", "#DFEDF9", "#DCF1E8", "#F8E4DA", "#E8E9EE"];

const SIZES = {
  // /apps cards.
  lg: { px: 56, box: "h-14 w-14 rounded-2xl", pad: "p-2", letter: "text-2xl" },
  // Admin rows and request cards.
  sm: { px: 40, box: "h-10 w-10 rounded-xl", pad: "p-1.5", letter: "text-lg" },
} as const;

// An app's PocketID logo, or its first letter on a tint. Decorative: the
// surrounding card or row always names the app.
export function AppMark({
  name,
  iconUrl,
  size = "lg",
}: {
  name: string;
  iconUrl: string | null;
  size?: keyof typeof SIZES;
}) {
  const s = SIZES[size];
  if (iconUrl) {
    return (
      // A plain <img>, as in the site header: next/image would need
      // PocketID's host in remotePatterns.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={iconUrl}
        alt=""
        width={s.px}
        height={s.px}
        className={`${s.box} ${s.pad} flex-none border border-line bg-surface object-contain`}
      />
    );
  }
  const tint = TINTS[[...name].reduce((sum, c) => sum + c.charCodeAt(0), 0) % TINTS.length];
  return (
    <span
      aria-hidden="true"
      style={{ background: tint }}
      className={`${s.box} ${s.letter} inline-flex flex-none items-center justify-center font-extrabold text-[#1f1b16]`}
    >
      {[...name.trim()][0]?.toUpperCase() ?? "?"}
    </span>
  );
}
