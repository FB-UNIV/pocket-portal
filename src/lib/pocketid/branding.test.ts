import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  brandColors,
  brandStyleSheet,
  contrastRatio,
  DARK_GROUND,
  darkBrandColors,
  getPocketIdBranding,
  getPortalName,
} from "./branding";

// Records what branding.ts hands to React's cache(), passing it through.
const { cacheSpy } = vi.hoisted(() => ({ cacheSpy: vi.fn(<T,>(fn: T) => fn) }));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: cacheSpy,
}));
// Taken at import time: mock call history is cleared before each test.
const memoized = cacheSpy.mock.results.map((result) => result.value);

describe("brandColors", () => {
  it("ignores PocketID's default and anything that isn't a plain oklch()", () => {
    for (const value of [
      "default",
      "",
      "red",
      "#ff0000",
      "oklch(0.6 0.2 15 / 0.5)",
      "oklch(0.6 0.2)",
      "oklch(0.6 0.2 15); background: url(x)",
    ]) {
      expect(brandColors(value), value).toBeNull();
    }
  });

  it("converts to an sRGB hex, so what's painted is what was measured", () => {
    expect(brandColors("oklch(0 0 0)")).toMatchObject({ brand: "#000000", onBrand: "#ffffff" });
    expect(brandColors("oklch(100% 0 0)")).toMatchObject({ brand: "#ffffff", onBrand: "#000000" });
  });

  it("accepts PocketID's presets, including a hue in degrees", () => {
    expect(brandColors("oklch(0.63 0.2 15)")?.brand).toMatch(/^#[0-9a-f]{6}$/);
    expect(brandColors("oklch(0.63 0.2 15deg)")).toEqual(brandColors("oklch(0.63 0.2 15)"));
  });

  // Digits alone can still overflow to Infinity, and the maths then yields NaN.
  it("ignores a value so large it isn't a finite number", () => {
    expect(brandColors(`oklch(0.5 ${"9".repeat(400)} 15)`)).toBeNull();
  });

  it("clamps an out-of-gamut accent instead of emitting an impossible colour", () => {
    expect(brandColors("oklch(0.7 0.5 140)")?.brand).toMatch(/^#[0-9a-f]{6}$/);
  });

  // The accessibility pass fixed three contrast failures; an admin-chosen accent must not bring
  // them back. Black or white always reaches >= 4.58:1 on some colour, so
  // picking the better one is enough.
  it.each([
    "oklch(0.63 0.2 15)",
    "oklch(0.6 0.12 250)",
    "oklch(0.85 0.15 90)",
    "oklch(0.55 0 0)",
    "oklch(0.64 0.2 145)",
  ])("keeps button text >= 4.5:1 on %s, hovered or not", (accent) => {
    const colors = brandColors(accent)!;

    expect(contrastRatio(colors.brand, colors.onBrand)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.brandHover, colors.onBrand)).toBeGreaterThanOrEqual(
      contrastRatio(colors.brand, colors.onBrand),
    );
  });
});

// The dark theme paints the same accent on a near-black page. A navy or
// forest accent that reads well on paper all but vanishes there, so the dark
// variant is lightened until the button's shape stands out (SC 1.4.11, 3:1).
describe("darkBrandColors", () => {
  it("lightens an accent that would vanish on the dark page", () => {
    const light = brandColors("oklch(0.32 0.09 262)")!;
    expect(contrastRatio(light.brand, DARK_GROUND)).toBeLessThan(3);

    const dark = darkBrandColors(light);

    expect(contrastRatio(dark.brand, DARK_GROUND)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(dark.brand, dark.onBrand)).toBeGreaterThanOrEqual(4.5);
  });

  it("leaves an accent that already stands out alone", () => {
    const light = brandColors("oklch(0.75 0.15 50)")!;

    expect(darkBrandColors(light)).toEqual(light);
  });

  it("keeps the hover state at least as readable as the button", () => {
    const dark = darkBrandColors(brandColors("oklch(0.25 0.05 150)")!);

    expect(contrastRatio(dark.brandHover, dark.onBrand)).toBeGreaterThanOrEqual(
      contrastRatio(dark.brand, dark.onBrand),
    );
  });
});

describe("brandStyleSheet", () => {
  it("sets the light variables, then the dark ones under the dark scheme", () => {
    const light = brandColors("oklch(0.32 0.09 262)")!;
    const dark = darkBrandColors(light);

    const css = brandStyleSheet(light);

    expect(css).toBe(
      `html:root{--brand:${light.brand};--on-brand:${light.onBrand};--brand-hover:${light.brandHover}}` +
        `@media (prefers-color-scheme: dark){html:root{--brand:${dark.brand};--on-brand:${dark.onBrand};--brand-hover:${dark.brandHover}}}`,
    );
  });

  // It ends up inside a <style> element: only the validated hex colours may
  // ever reach it.
  it("contains nothing but variable names and hex colours", () => {
    const css = brandStyleSheet(brandColors("oklch(0.6 0.2 30)")!);

    // No quotes, angle brackets, slashes or url(): nothing that could close
    // the <style> element or fetch anything.
    expect(css.replace(/#[0-9a-f]{6}/g, "")).toMatch(/^[a-z@:(){};\s-]+$/);
  });
});

describe("contrastRatio", () => {
  it("is 21:1 for black on white and 1:1 for a colour on itself", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBe(1);
  });
});

describe("getPocketIdBranding", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv("POCKETID_BASE_URL", "https://id.example.test");
    vi.stubGlobal("fetch", fetchMock.mockReset());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function respond(config: Array<{ key: string; value: string }>) {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(config.map((c) => ({ type: "string", ...c })))));
  }

  it("reads the public, unauthenticated config and points at the themed logos", async () => {
    respond([{ key: "accentColor", value: "oklch(0 0 0)" }]);

    const branding = await getPocketIdBranding();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://id.example.test/api/application-configuration");
    // No API key: the endpoint is public, and the key stays off this path.
    expect(init?.headers).toBeUndefined();
    expect(branding).toEqual({
      colors: expect.objectContaining({ brand: "#000000" }),
      name: null,
      logo: {
        light: "https://id.example.test/api/application-images/logo?light=true",
        dark: "https://id.example.test/api/application-images/logo?light=false",
      },
    });
  });

  // switched off, PocketID isn't even asked.
  it("returns null without fetching while FEATURE_POCKETID_BRANDING is off", async () => {
    vi.stubEnv("FEATURE_POCKETID_BRANDING", "false");

    expect(await getPocketIdBranding()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the logo but no colours when the accent is PocketID's default", async () => {
    respond([{ key: "accentColor", value: "default" }]);

    expect((await getPocketIdBranding())?.colors).toBeNull();
  });

  it("keeps no colours when the accent key is missing", async () => {
    respond([{ key: "appName", value: "Pocket ID" }]);

    expect((await getPocketIdBranding())?.colors).toBeNull();
  });

  it("takes the name the PocketID admin chose, trimmed", async () => {
    respond([{ key: "appName", value: "  Acme ID " }]);

    expect((await getPocketIdBranding())?.name).toBe("Acme ID");
  });

  // An untouched PocketID calls itself "Pocket ID"; the portal shouldn't.
  it.each(["Pocket ID", "", "  "])("keeps no name when PocketID's is %j", async (value) => {
    respond([{ key: "appName", value }]);

    expect((await getPocketIdBranding())?.name).toBeNull();
  });

  // The root layout awaits this on every render, so a PocketID that hangs
  // rather than refuses must not hang the portal with it.
  it("gives up on a slow PocketID", async () => {
    respond([]);

    await getPocketIdBranding();

    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("tolerates a trailing slash on POCKETID_BASE_URL", async () => {
    vi.stubEnv("POCKETID_BASE_URL", "https://id.example.test/");
    respond([]);

    const branding = await getPocketIdBranding();

    expect(fetchMock.mock.calls[0][0]).toBe("https://id.example.test/api/application-configuration");
    expect(branding?.logo.light).toBe("https://id.example.test/api/application-images/logo?light=true");
  });

  // Cosmetic: a PocketID outage must never take the portal's chrome down.
  it.each([
    ["PocketID is unreachable", () => fetchMock.mockRejectedValue(new Error("ECONNREFUSED"))],
    ["PocketID errors", () => fetchMock.mockResolvedValue(new Response("", { status: 503 }))],
    ["the body isn't the expected list", () => fetchMock.mockResolvedValue(new Response("{}"))],
    ["POCKETID_BASE_URL is unset", () => vi.stubEnv("POCKETID_BASE_URL", "")],
  ])("returns null when %s", async (_why, arrange) => {
    arrange();

    expect(await getPocketIdBranding()).toBeNull();
  });
});

describe("getPortalName", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv("POCKETID_BASE_URL", "https://id.example.test");
    vi.stubGlobal("fetch", fetchMock.mockReset());
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([{ key: "appName", type: "string", value: "Acme ID" }])),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("prefers PORTAL_NAME, without asking PocketID", async () => {
    vi.stubEnv("PORTAL_NAME", "Acme Apps");

    expect(await getPortalName()).toBe("Acme Apps");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to PocketID's name", async () => {
    expect(await getPortalName()).toBe("Acme ID");
  });

  it.each([
    ["PocketID branding is off", () => vi.stubEnv("FEATURE_POCKETID_BRANDING", "false")],
    ["PocketID is unreachable", () => fetchMock.mockRejectedValue(new Error("ECONNREFUSED"))],
    [
      "PocketID has its default name",
      () =>
        fetchMock.mockResolvedValue(
          new Response(JSON.stringify([{ key: "appName", type: "string", value: "Pocket ID" }])),
        ),
    ],
  ])("falls back to Pocket Portal when %s", async (_why, arrange) => {
    arrange();

    expect(await getPortalName()).toBe("Pocket Portal");
  });
});

// Its fetch passes an abort signal, which opts it out of Next's per-render
// fetch dedupe. Without React's cache, one render (layout, metadata, home
// page) could ask PocketID three times, and a flaky PocketID could give the
// header, heading and title different names.
describe("getPocketIdBranding per render", () => {
  it("is memoized with React's cache, failures included", () => {
    expect(memoized).toEqual([getPocketIdBranding]);
  });
});
