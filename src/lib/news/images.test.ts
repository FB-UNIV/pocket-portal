import { describe, it, expect } from "vitest";
import { crc32 } from "node:zlib";
import { MAX_IMAGE_BYTES, checkImage, sniffImageType, stripMetadata } from "./images";

// #22: news pictures. The type is read from the file's first bytes, never
// its name or what the browser declared; SVG is refused (it can carry
// scripts); and metadata (EXIF with GPS and camera, text chunks) is
// stripped before anything is stored.

const bytes = (...parts: (number[] | string | Uint8Array)[]) =>
  Uint8Array.from(
    parts.flatMap((p) => (typeof p === "string" ? [...Buffer.from(p, "latin1")] : [...p])),
  );
const has = (haystack: Uint8Array, needle: string) => Buffer.from(haystack).includes(Buffer.from(needle, "latin1"));
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u32le = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];

function pngChunk(type: string, data: number[] | string) {
  const body = bytes(type, typeof data === "string" ? data : data);
  return bytes(u32(body.length - 4), body, u32(crc32(body)));
}
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_WITH_TEXT = bytes(
  PNG_SIG,
  pngChunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
  pngChunk("tEXt", "Comment\0GPS 48.85N 2.35E"),
  pngChunk("IDAT", [0x78, 0x9c, 0x63, 0x60, 0, 0, 0, 2, 0, 1]),
  pngChunk("IEND", []),
);

const JPEG_WITH_EXIF = bytes(
  [0xff, 0xd8],
  [0xff, 0xe0, 0x00, 0x10], "JFIF\0", [1, 1, 0, 0, 1, 0, 1, 0, 0],
  [0xff, 0xe1, 0x00, 0x15], "Exif\0\0GPS 48.85N 2E",
  [0xff, 0xfe, 0x00, 0x0a], "camera X",
  [0xff, 0xe2, 0x00, 0x08], "ICC_\0\0",
  [0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0], "scan-data", [0xff, 0xd9],
);

function webp(...chunks: Uint8Array[]) {
  const body = bytes("WEBP", ...chunks);
  return bytes("RIFF", u32le(body.length), body);
}
const riffChunk = (fourcc: string, data: string) => {
  const payload = bytes(data);
  return bytes(fourcc, u32le(payload.length), payload, payload.length % 2 ? [0] : []);
};
// VP8X flags: 0x08 EXIF, 0x04 XMP.
const WEBP_WITH_EXIF = webp(
  bytes("VP8X", u32le(10), [0x08 | 0x04, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  riffChunk("VP8L", "pixels"),
  riffChunk("EXIF", "GPS 48.85N"),
  riffChunk("XMP ", "<x:xmpmeta>camera</x:xmpmeta>"),
);

describe("sniffImageType", () => {
  it.each([
    ["PNG", PNG_WITH_TEXT, "image/png"],
    ["JPEG", JPEG_WITH_EXIF, "image/jpeg"],
    ["WebP", WEBP_WITH_EXIF, "image/webp"],
    ["GIF", bytes("GIF89a", [1, 0, 1, 0]), "image/gif"],
  ])("knows a %s by its first bytes", (_name, file, type) => {
    expect(sniffImageType(file)).toBe(type);
  });

  it.each([
    ["SVG", bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ["HTML", bytes("<!doctype html><script>alert(1)</script>")],
    ["a PDF", bytes("%PDF-1.7")],
    ["nothing", bytes([])],
  ])("refuses %s", (_name, file) => {
    expect(sniffImageType(file)).toBeNull();
  });
});

describe("stripMetadata", () => {
  it("drops a PNG's text chunks and keeps the image", () => {
    const out = stripMetadata(PNG_WITH_TEXT, "image/png");

    expect(has(out, "tEXt")).toBe(false);
    expect(has(out, "GPS")).toBe(false);
    for (const chunk of ["IHDR", "IDAT", "IEND"]) expect(has(out, chunk)).toBe(true);
    expect([...out.slice(0, 8)]).toEqual(PNG_SIG);
  });

  it("drops a JPEG's EXIF and comments, keeping JFIF, the colour profile and the scan", () => {
    const out = stripMetadata(JPEG_WITH_EXIF, "image/jpeg");

    expect(has(out, "Exif")).toBe(false);
    expect(has(out, "GPS")).toBe(false);
    expect(has(out, "camera")).toBe(false);
    for (const kept of ["JFIF", "ICC_", "scan-data"]) expect(has(out, kept)).toBe(true);
    expect([...out.slice(0, 2)]).toEqual([0xff, 0xd8]);
    expect([...out.slice(-2)]).toEqual([0xff, 0xd9]);
  });

  it("drops a WebP's EXIF and XMP, clears their flags and fixes the size", () => {
    const out = stripMetadata(WEBP_WITH_EXIF, "image/webp");

    expect(has(out, "GPS")).toBe(false);
    expect(has(out, "camera")).toBe(false);
    expect(has(out, "VP8L")).toBe(true);
    const flags = out[20];
    expect(flags & (0x08 | 0x04)).toBe(0);
    expect(Buffer.from(out).readUInt32LE(4)).toBe(out.length - 8);
  });

  it("leaves a GIF as it is", () => {
    const gif = bytes("GIF89a", [1, 0, 1, 0, 0, 0, 0, 0x3b]);

    expect(stripMetadata(gif, "image/gif")).toEqual(gif);
  });
});

describe("checkImage", () => {
  it("accepts a picture, stripped, with the type its bytes say", () => {
    const result = checkImage(PNG_WITH_TEXT);

    expect(result).toMatchObject({ ok: true, contentType: "image/png" });
    expect(result.ok && has(result.bytes, "GPS")).toBe(false);
  });

  it("refuses what isn't one, and what's too big", () => {
    expect(checkImage(bytes("<svg/>"))).toEqual({ ok: false, reason: "not_an_image" });
    expect(checkImage(new Uint8Array(MAX_IMAGE_BYTES + 1))).toEqual({ ok: false, reason: "too_big" });
    expect(MAX_IMAGE_BYTES).toBe(5 * 1024 * 1024);
  });

  // A malformed file must not take the server down or slip through.
  it("refuses a file that claims to be a picture but is broken", () => {
    expect(checkImage(bytes([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]))).toEqual({ ok: false, reason: "not_an_image" });
    expect(checkImage(bytes(PNG_SIG, u32(9999), "IHDR"))).toEqual({ ok: false, reason: "not_an_image" });
  });
});
