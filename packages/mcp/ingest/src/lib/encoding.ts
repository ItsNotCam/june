// author: Claude
import { EncodingDetectionError } from "./errors";

/**
 * Stage 2 encoding normalization per I3 / [§15.1](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#151-encoding-normalization-per-i3).
 *
 * Order is fixed for every file:
 *   1. BOM detection — UTF-8, UTF-16 LE/BE, UTF-32 LE/BE.
 *   2. Heuristic fallback — UTF-8 strict, then Windows-1252.
 *   3. Line-ending normalization (CRLF / CR → LF).
 *   4. Strip zero-width characters.
 *
 * Output is guaranteed to be valid UTF-8 text with LF line endings and no
 * hidden-character surprises. Char offsets in downstream stages index into
 * this normalized string.
 */

const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;
const UTF16_LE_BOM = [0xff, 0xfe] as const;
const UTF16_BE_BOM = [0xfe, 0xff] as const;
const UTF32_LE_BOM = [0xff, 0xfe, 0x00, 0x00] as const;
const UTF32_BE_BOM = [0x00, 0x00, 0xfe, 0xff] as const;

/** Returns true if `bytes` starts with the byte prefix `pref`. */
const startsWith = (bytes: Uint8Array, pref: ReadonlyArray<number>): boolean => {
  if (bytes.length < pref.length) return false;
  for (let i = 0; i < pref.length; i++) {
    if (bytes[i] !== pref[i]) return false;
  }
  return true;
};

/** Decode UTF-16 given a byte buffer and endianness. */
const decodeUtf16 = (bytes: Uint8Array, littleEndian: boolean): string => {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let out = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    out += String.fromCharCode(dv.getUint16(i, littleEndian));
  }
  return out;
};

/** Decode UTF-32 given a byte buffer and endianness. */
const decodeUtf32 = (bytes: Uint8Array, littleEndian: boolean): string => {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let out = "";
  for (let i = 0; i + 3 < bytes.length; i += 4) {
    out += String.fromCodePoint(dv.getUint32(i, littleEndian));
  }
  return out;
};

const tryUtf8 = (bytes: Uint8Array): string | null => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
};

const tryWin1252 = (bytes: Uint8Array): string | null => {
  try {
    return new TextDecoder("windows-1252", { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
};

/**
 * Fully normalize `bytes` to a UTF-8-without-BOM, LF-only, zero-width-free
 * string. Throws `EncodingDetectionError` when every decode attempt fails.
 */
export const normalizeBytes = (
  bytes: Uint8Array,
  source_uri: string,
): string => {
  let text: string;
  if (startsWith(bytes, UTF32_LE_BOM)) {
    text = decodeUtf32(bytes.subarray(4), true);
  } else if (startsWith(bytes, UTF32_BE_BOM)) {
    text = decodeUtf32(bytes.subarray(4), false);
  } else if (startsWith(bytes, UTF16_LE_BOM)) {
    text = decodeUtf16(bytes.subarray(2), true);
  } else if (startsWith(bytes, UTF16_BE_BOM)) {
    text = decodeUtf16(bytes.subarray(2), false);
  } else if (startsWith(bytes, UTF8_BOM)) {
    const decoded = tryUtf8(bytes.subarray(3));
    if (decoded === null) throw new EncodingDetectionError(source_uri);
    text = decoded;
  } else {
    const utf8 = tryUtf8(bytes);
    if (utf8 !== null) {
      text = utf8;
    } else {
      const cp1252 = tryWin1252(bytes);
      if (cp1252 === null) throw new EncodingDetectionError(source_uri);
      text = cp1252;
    }
  }

  // Line endings: \r\n and lone \r → \n.
  text = text.replace(/\r\n?/g, "\n");

  // Strip zero-width characters (I3). U+FEFF mid-document is also caught here.
  text = text.replace(/[\u200B\u200C\u200D\uFEFF\u2060]/g, "");

  return text;
};
