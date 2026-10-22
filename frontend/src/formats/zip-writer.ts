/**
 * Streaming ZIP writer (projet.md 17: print pages proposed as a ZIP).
 *
 * Entries are written one after the other without knowing their size in advance: local header
 * with general purpose bit 3 (sizes and CRC in a data descriptor after the data) and bit 11
 * (UTF-8 names), data stored or deflated (raw deflate, native CompressionStream or the JS
 * fallback), data descriptor; the central directory and the end record close the archive.
 * No ZIP64: the archive is limited to 4 GiB and 65 535 entries (ZipLimitError beyond).
 */
import {
  createDeflateStream,
  crc32,
  type ByteSink,
  type DeflateStreamOptions,
} from './png-encoder';

export class ZipLimitError extends Error {
  override readonly name = 'ZipLimitError';
}

export type ZipMethod = 'store' | 'deflate';

export interface ZipEntryOptions {
  /** 'store' (default; right for PNG, already compressed) or 'deflate'. */
  readonly method?: ZipMethod;
  readonly modified?: Date;
}

export interface ZipEntryWriter {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

interface CentralRecord {
  readonly name: Uint8Array;
  readonly method: number;
  readonly time: number;
  readonly date: number;
  readonly crc: number;
  readonly compressed: number;
  readonly size: number;
  readonly offset: number;
}

const FLAGS = 0x0808; // bit 3: data descriptor, bit 11: UTF-8 names
const VERSION = 20; // 2.0: deflate, folders
const MAX_U32 = 0xffffffff;

/** MS-DOS time and date (local time, 2 s resolution, 1980-2107). */
export function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export class ZipWriter {
  private offset = 0;
  private readonly records: CentralRecord[] = [];
  private entryOpen = false;
  private finished = false;

  constructor(
    private readonly sink: ByteSink,
    private readonly deflateOptions: DeflateStreamOptions = {},
  ) {}

  /** Bytes written so far. */
  get size(): number {
    return this.offset;
  }

  /** Starts an entry; the previous one must be closed. */
  async open(name: string, options: ZipEntryOptions = {}): Promise<ZipEntryWriter> {
    if (this.finished) throw new Error('ZIP already finished');
    if (this.entryOpen) throw new Error('Previous ZIP entry not closed');
    if (this.records.length >= 0xffff) throw new ZipLimitError('Too many ZIP entries');
    const nameBytes = new TextEncoder().encode(name.replace(/\\/g, '/'));
    if (nameBytes.length === 0 || nameBytes.length > 0xffff) throw new Error('Invalid entry name');
    const method = options.method === 'deflate' ? 8 : 0;
    const { time, date } = dosDateTime(options.modified ?? new Date());
    const headerOffset = this.offset;

    const header = new Uint8Array(30 + nameBytes.length);
    const h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, VERSION, true);
    h.setUint16(6, FLAGS, true);
    h.setUint16(8, method, true);
    h.setUint16(10, time, true);
    h.setUint16(12, date, true);
    // CRC, sizes: 0 (data descriptor); name length; extra length 0.
    h.setUint16(26, nameBytes.length, true);
    header.set(nameBytes, 30);
    await this.emit(header);

    let crc = 0;
    let size = 0;
    let compressed = 0;
    const out: ByteSink = async (bytes) => {
      compressed += bytes.length;
      await this.emit(bytes);
    };
    const deflater = method === 8 ? createDeflateStream('raw', out, this.deflateOptions) : null;
    let closed = false;
    this.entryOpen = true;

    return {
      write: async (data: Uint8Array) => {
        if (closed) throw new Error('ZIP entry closed');
        crc = crc32(data, crc);
        size += data.length;
        if (size > MAX_U32) throw new ZipLimitError('ZIP entry larger than 4 GiB');
        if (deflater !== null) await deflater.write(data);
        else await out(data);
      },
      close: async () => {
        if (closed) return;
        closed = true;
        if (deflater !== null) await deflater.close();
        const descriptor = new Uint8Array(16);
        const d = new DataView(descriptor.buffer);
        d.setUint32(0, 0x08074b50, true);
        d.setUint32(4, crc, true);
        d.setUint32(8, compressed, true);
        d.setUint32(12, size, true);
        await this.emit(descriptor);
        this.records.push({
          name: nameBytes,
          method,
          time,
          date,
          crc,
          compressed,
          size,
          offset: headerOffset,
        });
        this.entryOpen = false;
      },
    };
  }

  /** Writes the central directory and the end record. */
  async finish(): Promise<void> {
    if (this.finished) return;
    if (this.entryOpen) throw new Error('ZIP entry not closed');
    this.finished = true;
    const start = this.offset;
    for (const r of this.records) {
      const e = new Uint8Array(46 + r.name.length);
      const v = new DataView(e.buffer);
      v.setUint32(0, 0x02014b50, true);
      v.setUint16(4, VERSION, true); // made by (MS-DOS / FAT attributes)
      v.setUint16(6, VERSION, true);
      v.setUint16(8, FLAGS, true);
      v.setUint16(10, r.method, true);
      v.setUint16(12, r.time, true);
      v.setUint16(14, r.date, true);
      v.setUint32(16, r.crc, true);
      v.setUint32(20, r.compressed, true);
      v.setUint32(24, r.size, true);
      v.setUint16(28, r.name.length, true);
      // extra 0, comment 0, disk 0, internal attributes 0, external attributes 0
      v.setUint32(42, r.offset, true);
      e.set(r.name, 46);
      await this.emit(e);
    }
    const end = new Uint8Array(22);
    const v = new DataView(end.buffer);
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, this.records.length, true);
    v.setUint16(10, this.records.length, true);
    v.setUint32(12, this.offset - start, true);
    v.setUint32(16, start, true);
    await this.emit(end);
  }

  private async emit(bytes: Uint8Array): Promise<void> {
    if (this.offset + bytes.length > MAX_U32) throw new ZipLimitError('ZIP larger than 4 GiB');
    this.offset += bytes.length;
    await this.sink(bytes);
  }
}
