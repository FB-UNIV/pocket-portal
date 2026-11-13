// News pictures (#22): what may be stored. The type comes from the file's
// first bytes ("magic bytes"), never its name or the type the browser
// declared, and only PNG, JPEG, WebP and GIF are accepted: no SVG, which is
// a document that can carry scripts. Metadata is stripped before storing:
// EXIF (GPS position, camera, date) and text chunks, so a photo taken on a
// phone doesn't publish where it was taken.
//
// Pure TypeScript on purpose: the portal ships without sharp/libvips (see
// next.config.ts), and this only removes segments, it never decodes pixels.
// Anything malformed is refused rather than half-stripped.

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type ImageType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

const startsWith = (bytes: Uint8Array, prefix: number[], at = 0) =>
  bytes.length >= at + prefix.length && prefix.every((b, i) => bytes[at + i] === b);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "image/webp";
  if (startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a"))) return "image/gif";
  return null;
}

class Malformed extends Error {}

function need(bytes: Uint8Array, end: number) {
  if (end > bytes.length) throw new Malformed();
}

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

// PNG: signature, then chunks of length(4, big-endian) type(4) data crc(4).
// Kept chunks are copied as they are, CRC included.
const PNG_DROP = new Set(["eXIf", "tEXt", "iTXt", "zTXt", "tIME"]);
function stripPng(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts = [bytes.subarray(0, 8)];
  let at = 8;
  let ended = false;
  while (at < bytes.length) {
    need(bytes, at + 8);
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const end = at + 12 + length;
    need(bytes, end);
    if (!PNG_DROP.has(type)) parts.push(bytes.subarray(at, end));
    at = end;
    if (type === "IEND") {
      ended = true;
      break;
    }
  }
  if (!ended) throw new Malformed();
  return concat(parts);
}

// JPEG: SOI, then segments FFxx + length(2, big-endian, counting itself)
// until SOS, after which the compressed scan runs to EOI and is kept as is.
// Dropped: APP1 (EXIF/XMP: GPS, camera), APP12, APP13 (IPTC/Photoshop),
// COM. Kept: APP0 (JFIF), APP2 (ICC colour profile), APP14 (Adobe colour),
// and every coding segment.
const JPEG_DROP = new Set([0xe1, 0xec, 0xed, 0xfe]);
function stripJpeg(bytes: Uint8Array): Uint8Array {
  const parts = [bytes.subarray(0, 2)];
  let at = 2;
  for (;;) {
    need(bytes, at + 4);
    if (bytes[at] !== 0xff) throw new Malformed();
    const marker = bytes[at + 1];
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (length < 2) throw new Malformed();
    const end = at + 2 + length;
    need(bytes, end);
    if (marker === 0xda) {
      // Start of scan: the rest is image data.
      parts.push(bytes.subarray(at));
      return concat(parts);
    }
    if (!JPEG_DROP.has(marker)) parts.push(bytes.subarray(at, end));
    at = end;
  }
}

// WebP: RIFF size(4, little-endian) WEBP, then chunks fourcc size(4 LE)
// data, padded to an even length. Dropped: EXIF and "XMP ", with their
// flags cleared in VP8X so readers don't look for them; RIFF size fixed.
function stripWebp(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  need(bytes, 12);
  const parts: Uint8Array[] = [];
  let at = 12;
  while (at < bytes.length) {
    need(bytes, at + 8);
    const fourcc = String.fromCharCode(...bytes.subarray(at, at + 4));
    const size = view.getUint32(at + 4, true);
    const end = at + 8 + size + (size % 2);
    need(bytes, end);
    if (fourcc !== "EXIF" && fourcc !== "XMP ") {
      const chunk = bytes.slice(at, end);
      if (fourcc === "VP8X" && size >= 1) chunk[8] &= ~(0x08 | 0x04);
      parts.push(chunk);
    }
    at = end;
  }
  const body = concat([Uint8Array.from(ascii("WEBP")), ...parts]);
  const header = new Uint8Array(8);
  header.set(ascii("RIFF"));
  new DataView(header.buffer).setUint32(4, body.length, true);
  return concat([header, body]);
}

export function stripMetadata(bytes: Uint8Array, type: ImageType): Uint8Array {
  if (type === "image/png") return stripPng(bytes);
  if (type === "image/jpeg") return stripJpeg(bytes);
  if (type === "image/webp") return stripWebp(bytes);
  // GIF has no EXIF; left as uploaded.
  return bytes;
}

export type ImageCheck =
  | { ok: true; contentType: ImageType; bytes: Uint8Array }
  | { ok: false; reason: "too_big" | "not_an_image" };

export function checkImage(bytes: Uint8Array): ImageCheck {
  if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, reason: "too_big" };
  const type = sniffImageType(bytes);
  if (!type) return { ok: false, reason: "not_an_image" };
  try {
    return { ok: true, contentType: type, bytes: stripMetadata(bytes, type) };
  } catch (err) {
    if (err instanceof Malformed) return { ok: false, reason: "not_an_image" };
    throw err;
  }
}
