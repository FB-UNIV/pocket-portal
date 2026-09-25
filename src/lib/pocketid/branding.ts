import { cache } from "react";
import {
  DEFAULT_PORTAL_NAME,
  readPocketIdBaseUrl,
  readPocketIdBrandingEnabled,
  readPortalName,
} from "@/lib/config";

// PocketID's branding, inherited by the portal: the admin-chosen accent
// colour, name and logo. Both come from unauthenticated endpoints, so the API
// key never goes near this path.
//
// Cosmetic by definition: any failure means "no branding", never an error,
// so a PocketID outage can't take the portal's chrome down with it.

export interface BrandColors {
  // All sRGB hex. PocketID stores the accent as OKLCH, but a browser gamut-maps
  // an out-of-range OKLCH value its own way; emitting the clamped sRGB colour
  // means what gets painted is exactly what was measured for contrast.
  brand: string;
  onBrand: string;
  brandHover: string;
}

export interface Branding {
  colors: BrandColors | null;
  name: string | null;
  logo: { light: string; dark: string };
}

// Only the space-separated form PocketID's picker writes. No alpha: a
// translucent button's contrast depends on whatever is behind it. Anything
// else, including PocketID's "default", means no accent. PocketID doesn't
// validate the stored value, so this parse is also what keeps arbitrary text
// out of the page's style attribute.
const OKLCH = /^oklch\(\s*(\d*\.?\d+)(%?)\s+(\d*\.?\d+)\s+(-?\d*\.?\d+)(?:deg)?\s*\)$/i;

// OKLab -> linear sRGB, from Björn Ottosson's reference implementation.
function oklchToLinearSrgb(l: number, c: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function encode(linear: number): number {
  const v = clamp01(linear);
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}

function decode(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, "0")).join("")}`;
}

function fromHex(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
}

// WCAG 2.x relative luminance, from the rounded hex: the colour axe and the
// browser actually see.
function luminance(hex: string): number {
  const [r, g, b] = fromHex(hex).map(decode);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Moves a colour toward `target` by `amount` in sRGB space. Toward black or
// white, luminance moves monotonically, so mixing away from the text colour
// can only raise the text's contrast.
function mix(hex: string, target: string, amount: number): string {
  const from = fromHex(hex);
  const to = fromHex(target);
  return toHex(from.map((v, i) => v + (to[i] - v) * amount) as [number, number, number]);
}

export function brandColors(accent: string): BrandColors | null {
  const match = OKLCH.exec(accent.trim());
  if (!match) return null;

  const lightness = Number(match[1]) / (match[2] ? 100 : 1);
  const [r, g, b] = oklchToLinearSrgb(lightness, Number(match[3]), Number(match[4]));
  // Digits alone can overflow to Infinity, which the maths turns into NaN;
  // that must never reach toHex and the style attribute.
  if (![r, g, b].every(Number.isFinite)) return null;
  const brand = toHex([encode(r), encode(g), encode(b)]);

  // No fallback needed: on any colour, black or white text reaches at least
  // ~4.58:1 (the worst case is a luminance near 0.18), which clears the 4.5:1
  // SC 1.4.3 asks of button text. So the better of the two always passes.
  const onBrand =
    contrastRatio(brand, "#000000") >= contrastRatio(brand, "#ffffff") ? "#000000" : "#ffffff";
  const brandHover = mix(brand, onBrand === "#000000" ? "#ffffff" : "#000000", 0.15);

  return { brand, onBrand, brandHover };
}

// Public config is a list of { key, type, value } (PocketID's
// PublicAppConfigVariableDto). Cached per replica for five minutes: safe to
// lose or to differ briefly between replicas, since it only picks a colour.
// The root layout awaits this on every render: a PocketID that hangs rather
// than refuses must cost at most this long, then fall back to no branding.
const TIMEOUT_MS = 2_000;

// What an untouched PocketID calls itself: naming the portal that would make
// it look like PocketID's own UI.
const POCKETID_DEFAULT_NAME = "Pocket ID";

function appName(value: unknown): string | null {
  const name = typeof value === "string" ? value.trim() : "";
  return name && name !== POCKETID_DEFAULT_NAME ? name : null;
}

// Once per render, whatever the outcome: the abort signal opts this fetch
// out of Next's own dedupe, so without cache() the layout, its metadata and
// the home page would each ask PocketID, and a flaky PocketID could hand
// them different names.
export const getPocketIdBranding = cache(async (): Promise<Branding | null> => {
  const baseUrl = readPocketIdBaseUrl();
  if (!baseUrl || !readPocketIdBrandingEnabled()) return null;

  try {
    const res = await fetch(`${baseUrl}/api/application-configuration`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const config: unknown = await res.json();
    if (!Array.isArray(config)) return null;

    const accent = config.find((entry) => entry?.key === "accentColor")?.value;
    return {
      colors: typeof accent === "string" ? brandColors(accent) : null,
      name: appName(config.find((entry) => entry?.key === "appName")?.value),
      logo: {
        light: `${baseUrl}/api/application-images/logo?light=true`,
        dark: `${baseUrl}/api/application-images/logo?light=false`,
      },
    };
  } catch {
    return null;
  }
});

// The name users see: PORTAL_NAME, else PocketID's, else Pocket Portal.
// Shares the render's single getPocketIdBranding() result, so asking again
// costs nothing.
export async function getPortalName(): Promise<string> {
  return readPortalName() ?? (await getPocketIdBranding())?.name ?? DEFAULT_PORTAL_NAME;
}
