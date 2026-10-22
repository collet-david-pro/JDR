/**
 * Reading of a map file chosen for import (JSON document or ZIP `{map.json, assets/…}`,
 * etapes/P04 "Contrat d'API P4c"), before uploading it: the import dialog shows a preview
 * (name, size, number of assets) and the problems found by the client validation.
 *
 * The ZIP reader only needs the central directory and the `map.json` entry (stored or
 * deflate): the images stay in the Blob, never read in memory.
 */
import { CompressionError, inflateRaw } from './compression';
import {
  checkMapDocumentBlocks,
  documentAssetRefs,
  MapDocumentError,
  parseMapDocument,
  type MapDocumentIssue,
  type MapDocumentV1,
} from './map-document';

/** Largest JSON document read in the browser (bigger files are refused before upload). */
export const MAP_JSON_MAX_BYTES = 64 * 1024 * 1024;
export const ZIP_MAP_ENTRY = 'map.json';
export const ZIP_ASSETS_DIR = 'assets/';

export type MapFileErrorCode =
  | 'empty'
  | 'too_large'
  | 'unknown_type'
  | 'bad_zip'
  | 'zip_without_map'
  | 'not_json'
  | 'not_a_map'
  | 'unsupported_format_version'
  | 'missing_migration'
  | 'invalid';

export class MapFileError extends Error {
  override readonly name = 'MapFileError';
  constructor(
    readonly code: MapFileErrorCode,
    readonly issues: readonly MapDocumentIssue[] = [],
    readonly version: number | null = null,
  ) {
    super(code);
  }
}

export interface MapFilePreview {
  readonly container: 'json' | 'zip';
  readonly fileName: string;
  readonly fileSize: number;
  readonly doc: MapDocumentV1;
  /** Format version of the file (before migration). */
  readonly formatVersion: number;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** Distinct asset references of the document. */
  readonly assets: number;
  /** Image files carried by a ZIP (assets/…); 0 for JSON. */
  readonly bundledAssets: number;
  /** Non-empty tile blocks. */
  readonly blocks: number;
  /** Non-empty cells (all tile layers). */
  readonly cells: number;
}

/* ---- ZIP ------------------------------------------------------------------------------ */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN = 22;
const EOCD_SEARCH = EOCD_MIN + 0xffff;

export interface ZipEntry {
  readonly name: string;
  /** 0 stored, 8 deflate. */
  readonly method: number;
  readonly compressedSize: number;
  readonly size: number;
  readonly localOffset: number;
}

async function bytesOf(blob: Blob, start: number, end: number): Promise<DataView> {
  const buffer = await blob.slice(start, end).arrayBuffer();
  return new DataView(buffer);
}

const utf8 = new TextDecoder('utf-8');

/** Entries of the central directory (ZIP64 and multi-disk archives are refused). */
export async function listZipEntries(blob: Blob): Promise<ZipEntry[]> {
  if (blob.size < EOCD_MIN) throw new MapFileError('bad_zip');
  const tailStart = Math.max(0, blob.size - EOCD_SEARCH);
  const tail = await bytesOf(blob, tailStart, blob.size);
  let eocd = -1;
  for (let i = tail.byteLength - EOCD_MIN; i >= 0; i--) {
    if (tail.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new MapFileError('bad_zip');
  const count = tail.getUint16(eocd + 10, true);
  const dirSize = tail.getUint32(eocd + 12, true);
  const dirOffset = tail.getUint32(eocd + 16, true);
  if (
    tail.getUint16(eocd + 4, true) !== 0 ||
    count === 0xffff ||
    dirOffset === 0xffffffff ||
    dirOffset + dirSize > blob.size
  ) {
    throw new MapFileError('bad_zip');
  }
  const dir = await bytesOf(blob, dirOffset, dirOffset + dirSize);
  const entries: ZipEntry[] = [];
  let o = 0;
  for (let i = 0; i < count; i++) {
    if (o + 46 > dir.byteLength || dir.getUint32(o, true) !== CENTRAL_SIGNATURE) {
      throw new MapFileError('bad_zip');
    }
    const nameLength = dir.getUint16(o + 28, true);
    const extraLength = dir.getUint16(o + 30, true);
    const commentLength = dir.getUint16(o + 32, true);
    if (o + 46 + nameLength > dir.byteLength) throw new MapFileError('bad_zip');
    const name = utf8.decode(new Uint8Array(dir.buffer, dir.byteOffset + o + 46, nameLength));
    entries.push({
      name,
      method: dir.getUint16(o + 10, true),
      compressedSize: dir.getUint32(o + 20, true),
      size: dir.getUint32(o + 24, true),
      localOffset: dir.getUint32(o + 42, true),
    });
    o += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Content of one entry (stored or deflate), bounded to `maxBytes`. */
export async function readZipEntry(
  blob: Blob,
  entry: ZipEntry,
  maxBytes: number,
): Promise<Uint8Array> {
  if (entry.size > maxBytes || entry.compressedSize === 0xffffffff) {
    throw new MapFileError('too_large');
  }
  const header = await bytesOf(blob, entry.localOffset, entry.localOffset + 30);
  if (header.byteLength < 30 || header.getUint32(0, true) !== LOCAL_SIGNATURE) {
    throw new MapFileError('bad_zip');
  }
  const start = entry.localOffset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
  const end = start + entry.compressedSize;
  if (end > blob.size) throw new MapFileError('bad_zip');
  const data = new Uint8Array(await blob.slice(start, end).arrayBuffer());
  if (entry.method === 0) return data;
  if (entry.method !== 8) throw new MapFileError('bad_zip');
  try {
    return await inflateRaw(data, maxBytes);
  } catch (error) {
    if (error instanceof CompressionError) {
      throw new MapFileError(error.code === 'output_limit' ? 'too_large' : 'bad_zip');
    }
    throw error;
  }
}

/* ---- Preview -------------------------------------------------------------------------- */

/** Detects the container from the first bytes ("PK\x03\x04" = ZIP, "{" = JSON). */
async function containerOf(file: Blob, fileName: string): Promise<'json' | 'zip'> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return 'zip';
  let i = head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf ? 3 : 0;
  while (
    i < head.length &&
    (head[i] === 0x20 || head[i] === 0x0a || head[i] === 0x0d || head[i] === 0x09)
  )
    i++;
  if (head[i] === 0x7b || i >= head.length) return 'json';
  if (/\.json$/i.test(fileName)) return 'json';
  throw new MapFileError('unknown_type');
}

function fromDocumentError(error: unknown): never {
  if (error instanceof MapDocumentError) {
    throw new MapFileError(error.code, error.issues, error.version);
  }
  throw error;
}

/**
 * Reads, migrates and validates a map file (tile blocks decoded too). Throws MapFileError
 * with the reason (and the validation issues) when the file cannot be imported.
 */
export async function readMapFile(file: Blob, fileName: string): Promise<MapFilePreview> {
  if (file.size === 0) throw new MapFileError('empty');
  const container = await containerOf(file, fileName);
  let text: string;
  let bundledAssets = 0;
  if (container === 'zip') {
    const entries = await listZipEntries(file);
    const entry = entries.find((e) => e.name === ZIP_MAP_ENTRY);
    if (entry === undefined) throw new MapFileError('zip_without_map');
    bundledAssets = entries.filter(
      (e) => e.name.startsWith(ZIP_ASSETS_DIR) && !e.name.endsWith('/'),
    ).length;
    text = utf8.decode(await readZipEntry(file, entry, MAP_JSON_MAX_BYTES));
  } else {
    if (file.size > MAP_JSON_MAX_BYTES) throw new MapFileError('too_large');
    text = await file.text();
  }
  let parsed;
  try {
    parsed = parseMapDocument(text);
  } catch (error) {
    fromDocumentError(error);
  }
  const { doc, fromVersion } = parsed;
  const blocks = await checkMapDocumentBlocks(doc);
  if (blocks.issues.length > 0) throw new MapFileError('invalid', blocks.issues);
  return {
    container,
    fileName,
    fileSize: file.size,
    doc,
    formatVersion: fromVersion,
    name: doc.name,
    width: doc.grid.width,
    height: doc.grid.height,
    assets: documentAssetRefs(doc).length,
    bundledAssets,
    blocks: blocks.blocks,
    cells: blocks.cells,
  };
}
