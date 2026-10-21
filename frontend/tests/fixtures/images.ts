/** Minimal image headers built in memory (only what the header reader looks at). */

const be32 = (n: number): number[] => [
  (n >>> 24) & 255,
  (n >>> 16) & 255,
  (n >>> 8) & 255,
  n & 255,
];
const le16 = (n: number): number[] => [n & 255, (n >>> 8) & 255];
const le24 = (n: number): number[] => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
const le32 = (n: number): number[] => [...le16(n & 0xffff), ...le16(n >>> 16)];
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

export function png(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...be32(13),
    ...ascii('IHDR'),
    ...be32(width),
    ...be32(height),
    8,
    6,
    0,
    0,
    0,
    ...be32(0),
  ]);
}

export function jpeg(width: number, height: number): Uint8Array {
  const app0 = [0xff, 0xe0, 0, 16, ...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const sof0 = [
    0xff,
    0xc0,
    0,
    17,
    8,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    3,
    1,
    0x22,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
  ];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof0, 0xff, 0xd9]);
}

/** GIF with `delays.length` frames (delays in 1/100 s). */
export function gif(
  width: number,
  height: number,
  delays: readonly number[],
  trailer = true,
): Uint8Array {
  const bytes = [
    ...ascii('GIF89a'),
    ...le16(width),
    ...le16(height),
    0x80,
    0,
    0,
    0,
    0,
    0,
    255,
    255,
    255,
  ];
  bytes.push(0x21, 0xff, 11, ...ascii('NETSCAPE2.0'), 3, 1, 0, 0, 0);
  for (const delay of delays) {
    bytes.push(0x21, 0xf9, 4, 0, ...le16(delay), 0, 0);
    bytes.push(0x2c, 0, 0, 0, 0, ...le16(width), ...le16(height), 0);
    bytes.push(2, 2, 0x4c, 0x01, 0);
  }
  if (trailer) bytes.push(0x3b);
  return new Uint8Array(bytes);
}

function chunk(fourcc: string, payload: number[]): number[] {
  const out = [...ascii(fourcc), ...le32(payload.length), ...payload];
  if (payload.length % 2 === 1) out.push(0);
  return out;
}

function riff(chunks: number[]): Uint8Array {
  return new Uint8Array([
    ...ascii('RIFF'),
    ...le32(chunks.length + 4),
    ...ascii('WEBP'),
    ...chunks,
  ]);
}

export function webpLossless(width: number, height: number): Uint8Array {
  const bits = (width - 1) | ((height - 1) << 14);
  return riff(chunk('VP8L', [0x2f, ...le32(bits >>> 0)]));
}

export function webpLossy(width: number, height: number): Uint8Array {
  return riff(chunk('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(width), ...le16(height), 0, 0]));
}

/** Animated WebP with one ANMF chunk per duration (ms). */
export function webpAnimated(
  width: number,
  height: number,
  durations: readonly number[],
): Uint8Array {
  const chunks = [
    ...chunk('VP8X', [0x02, 0, 0, 0, ...le24(width - 1), ...le24(height - 1)]),
    ...chunk('ANIM', [0, 0, 0, 0, 0, 0]),
  ];
  for (const duration of durations) {
    chunks.push(
      ...chunk('ANMF', [
        ...le24(0),
        ...le24(0),
        ...le24(width - 1),
        ...le24(height - 1),
        ...le24(duration),
        0,
      ]),
    );
  }
  return riff(chunks);
}

export function fileOf(bytes: Uint8Array, name: string, padTo = 0): File {
  const parts: BlobPart[] = [bytes as Uint8Array<ArrayBuffer>];
  if (padTo > bytes.length) parts.push(new Uint8Array(padTo - bytes.length));
  return new File(parts, name);
}
