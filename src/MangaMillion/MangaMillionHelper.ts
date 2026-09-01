/* SPDX-License-Identifier: GPL-3.0-or-later */

// MANGA MILLION's backend (api.mangamillion.shueisha.co.jp) speaks raw protobuf with no
// published .proto schema, so responses are parsed generically by (field number, wire type)
// instead of through a generated/hand-written message definition like MangaPlus's.

type WireValue = { kind: "varint"; value: number } | { kind: "bytes"; value: Uint8Array };
type FieldMap = Map<number, WireValue[]>;

function readVarint(bytes: Uint8Array, offset: number): [number, number] {
  let value = 0;
  let shift = 0;
  let index = offset;

  for (;;) {
    const byte = bytes[index];
    if (byte === undefined) throw new Error("Unexpected end of buffer while reading varint");
    index++;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return [value >>> 0, index];
    shift += 7;
  }
}

function parseFields(bytes: Uint8Array): FieldMap {
  const fields: FieldMap = new Map();
  let offset = 0;

  while (offset < bytes.length) {
    let tag: number;
    [tag, offset] = readVarint(bytes, offset);
    const fieldNumber = tag >>> 3;
    const wireType = tag & 7;

    if (wireType === 0) {
      let value: number;
      [value, offset] = readVarint(bytes, offset);
      const entries = fields.get(fieldNumber) ?? [];
      entries.push({ kind: "varint", value });
      fields.set(fieldNumber, entries);
    } else if (wireType === 2) {
      let length: number;
      [length, offset] = readVarint(bytes, offset);
      const value = bytes.slice(offset, offset + length);
      offset += length;
      const entries = fields.get(fieldNumber) ?? [];
      entries.push({ kind: "bytes", value });
      fields.set(fieldNumber, entries);
    } else {
      // Fixed32/Fixed64 wire types never appear in MANGA MILLION's responses; bail rather
      // than misinterpret the rest of the buffer.
      break;
    }
  }

  return fields;
}

function bytesField(fields: FieldMap, fieldNumber: number): Uint8Array | undefined {
  const entry = fields.get(fieldNumber)?.[0];
  return entry?.kind === "bytes" ? entry.value : undefined;
}

function bytesFieldList(fields: FieldMap, fieldNumber: number): Uint8Array[] {
  return (fields.get(fieldNumber) ?? []).flatMap((entry) =>
    entry.kind === "bytes" ? [entry.value] : [],
  );
}

function varintField(fields: FieldMap, fieldNumber: number): number | undefined {
  const entry = fields.get(fieldNumber)?.[0];
  return entry?.kind === "varint" ? entry.value : undefined;
}

function stringField(fields: FieldMap, fieldNumber: number): string | undefined {
  const value = bytesField(fields, fieldNumber);
  return value ? new TextDecoder().decode(value) : undefined;
}

function subMessage(fields: FieldMap, fieldNumber: number): FieldMap | undefined {
  const value = bytesField(fields, fieldNumber);
  return value ? parseFields(value) : undefined;
}

function subMessageList(fields: FieldMap, fieldNumber: number): FieldMap[] {
  return bytesFieldList(fields, fieldNumber).map(parseFields);
}

export interface MangaMillionTitle {
  titleId: string;
  name: string;
  author: string;
  coverUrl: string;
  views: number;
}

function parseTitleSummary(fields: FieldMap): MangaMillionTitle | undefined {
  const titleId = varintField(fields, 1);
  const coverUrl = stringField(fields, 2);
  const name = stringField(fields, 3);
  const author = stringField(fields, 4);
  if (titleId === undefined || !name) return undefined;

  return {
    titleId: titleId.toString(),
    name,
    author: author ?? "",
    coverUrl: coverUrl ?? "",
    views: varintField(fields, 7) ?? 0,
  };
}

// The device access token from `POST /api/register` is nested one level deeper than the
// rest of the responses: the outer message only has field 170, a submessage whose field 1
// is the actual token string.
export function parseRegisterResponse(buffer: ArrayBuffer): string | undefined {
  const top = parseFields(new Uint8Array(buffer));
  const registration = subMessage(top, 170);
  return registration ? stringField(registration, 1) : undefined;
}

// `/api/manga_list` and `/api/search` both wrap a repeated list of the same title-summary
// message, just under different top-level field numbers (22 and 20 respectively).
function parseTitleList(buffer: ArrayBuffer, wrapperField: number): MangaMillionTitle[] {
  const top = parseFields(new Uint8Array(buffer));
  const wrapper = subMessage(top, wrapperField);
  if (!wrapper) return [];

  // Each entry is itself a one-field wrapper message around the actual title summary.
  return subMessageList(wrapper, 1)
    .map((item) => subMessage(item, 1))
    .filter((summary): summary is FieldMap => summary !== undefined)
    .map(parseTitleSummary)
    .filter((title): title is MangaMillionTitle => title !== undefined);
}

export function parseMangaList(buffer: ArrayBuffer): MangaMillionTitle[] {
  return parseTitleList(buffer, 22);
}

export function parseSearchResults(buffer: ArrayBuffer): MangaMillionTitle[] {
  return parseTitleList(buffer, 20);
}

export interface MangaMillionFilterOption {
  id: string;
  name: string;
}

function parseFilterOptions(fields: FieldMap, fieldNumber: number): MangaMillionFilterOption[] {
  return subMessageList(fields, fieldNumber)
    .map((option) => {
      const id = varintField(option, 1);
      const name = stringField(option, 2);
      return id !== undefined && name ? { id: id.toString(), name } : undefined;
    })
    .filter((option): option is MangaMillionFilterOption => option !== undefined);
}

export interface MangaMillionSearchParameters {
  genres: MangaMillionFilterOption[];
  themes: MangaMillionFilterOption[];
  highlights: MangaMillionFilterOption[];
  ratings: MangaMillionFilterOption[];
}

export function parseSearchParameters(buffer: ArrayBuffer): MangaMillionSearchParameters {
  const top = parseFields(new Uint8Array(buffer));
  const wrapper = subMessage(top, 21);
  if (!wrapper) return { genres: [], themes: [], highlights: [], ratings: [] };

  return {
    genres: parseFilterOptions(wrapper, 2),
    themes: parseFilterOptions(wrapper, 3),
    highlights: parseFilterOptions(wrapper, 4),
    ratings: parseFilterOptions(wrapper, 5),
  };
}

export interface MangaMillionTag {
  id: string;
  name: string;
}

export interface MangaMillionTitleDetail {
  coverUrl: string;
  name: string;
  author: string;
  tags: MangaMillionTag[];
  contentRating: string;
  description: string;
}

export function parseTitleDetail(buffer: ArrayBuffer): MangaMillionTitleDetail | undefined {
  const top = parseFields(new Uint8Array(buffer));
  const serviceTitle = subMessage(top, 50);
  const title = serviceTitle ? subMessage(serviceTitle, 1) : undefined;
  if (!title) return undefined;

  const tags = subMessageList(title, 4)
    .map((tag) => {
      const id = varintField(tag, 1);
      const name = stringField(tag, 2);
      return id !== undefined && name ? { id: id.toString(), name } : undefined;
    })
    .filter((tag): tag is MangaMillionTag => tag !== undefined);

  const contentRatingField = subMessage(title, 5);
  const contentRating = contentRatingField ? (stringField(contentRatingField, 2) ?? "") : "";

  return {
    coverUrl: stringField(title, 1) ?? "",
    name: stringField(title, 2) ?? "",
    author: stringField(title, 3) ?? "",
    tags,
    contentRating,
    description: stringField(title, 6) ?? "",
  };
}

export interface MangaMillionChapter {
  chapterId: string;
  number: string;
  name: string;
  thumbnailUrl: string;
}

export function parseChapterList(buffer: ArrayBuffer): MangaMillionChapter[] {
  const top = parseFields(new Uint8Array(buffer));
  const chapterList = subMessage(top, 60);
  if (!chapterList) return [];

  const groups = subMessageList(chapterList, 2);
  // Every chapter group we've observed contains the full chapter list for the title, just
  // grouped differently, so only the first group is needed.
  const firstGroup = groups[0];
  if (!firstGroup) return [];

  return subMessageList(firstGroup, 2)
    .map((chapter) => {
      // field3 is the actual `translated_chapter_id` used by `/api/viewer` (and the site's
      // own `/title/<id>/chapter/<translatedChapterId>` route) - it is NOT a sequential
      // per-title index, it's a global id across every title/language on the platform.
      const chapterId = varintField(chapter, 3);
      if (chapterId === undefined) return undefined;

      return {
        chapterId: chapterId.toString(),
        number: stringField(chapter, 1) ?? "",
        name: stringField(chapter, 2) ?? "",
        thumbnailUrl: stringField(chapter, 5) ?? "",
      };
    })
    .filter((chapter): chapter is MangaMillionChapter => chapter !== undefined);
}

export interface MangaMillionViewer {
  pageUrls: string[];
  aesKeyHex: string;
  aesIvHex: string;
}

export function parseViewer(buffer: ArrayBuffer): MangaMillionViewer | undefined {
  const top = parseFields(new Uint8Array(buffer));
  const viewer = subMessage(top, 70);
  if (!viewer) return undefined;

  const pageUrls = subMessageList(viewer, 1)
    .map((page) => stringField(page, 1))
    .filter((url): url is string => Boolean(url));

  const aesKeyHex = stringField(viewer, 7);
  const aesIvHex = stringField(viewer, 8);
  if (!aesKeyHex || !aesIvHex) return undefined;

  return { pageUrls, aesKeyHex, aesIvHex };
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// Page images are served as `<n>.avif.enc`: raw bytes, AES-256-CBC-encrypted with PKCS7
// padding, using the key/iv returned by `/api/viewer` for that chapter. The decrypted bytes
// are actually WEBP (RIFF), regardless of the `.avif` filename.
export async function decryptPage(
  data: ArrayBuffer,
  aesKeyHex: string,
  aesIvHex: string,
): Promise<ArrayBuffer> {
  const keyBytes = hexToBytes(aesKeyHex);
  const ivBytes = hexToBytes(aesIvHex);

  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, [
    "decrypt",
  ]);

  return crypto.subtle.decrypt({ name: "AES-CBC", iv: ivBytes }, cryptoKey, data);
}

// Pulled straight out of the page image URL, e.g.
// `.../translated_chapter_page_low/<chapterId>/<page>.avif.enc`.
export function chapterIdFromImageUrl(url: string): string | undefined {
  return /\/translated_chapter_page_(?:low|middle)\/(\d+)\//.exec(url)?.[1];
}
