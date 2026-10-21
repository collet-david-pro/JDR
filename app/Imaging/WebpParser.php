<?php

declare(strict_types=1);

namespace JDR\Imaging;

defined('JDR_BOOT') || exit;

/**
 * WebP RIFF walk and rewrite (projet.md 11.3 step 5, 3.1 point 19).
 *
 * - RIFF size + 8 must equal the file size exactly (inconsistent size = refused).
 * - Simple formats (VP8 lossy, VP8L lossless) and extended format (VP8X) are understood;
 *   VP8X flags: 0x20 ICC, 0x10 alpha, 0x08 EXIF, 0x04 XMP, 0x02 animation.
 * - Animated files: ANIM + ANMF frames (offset, size, duration, frame data ALPH/VP8/VP8L);
 *   frames must lie inside the canvas. Like browsers, a frame duration <= 10 ms is played and
 *   counted as 100 ms.
 * - Rewrite: EXIF, "XMP ", ICCP and unknown chunks (top level and inside ANMF) are dropped,
 *   VP8X flags are recomputed (ICC/EXIF/XMP cleared) and the RIFF size is recomputed.
 * - firstFrame: the first ANMF rebuilt as a static WebP that GD can decode (GD cannot read
 *   animated WebP), with its position on the canvas, for the thumbnail.
 */
final class WebpParser
{
    public const FLAG_ICC = 0x20;
    public const FLAG_ALPHA = 0x10;
    public const FLAG_EXIF = 0x08;
    public const FLAG_XMP = 0x04;
    public const FLAG_ANIMATION = 0x02;

    /** Browser rule: frame durations <= 10 ms are played as 100 ms. */
    public const MIN_DURATION_MS = 11;
    public const DEFAULT_DURATION_MS = 100;

    /**
     * @throws ImageRejected unsupported_type
     */
    public function parse(string $data): ParsedImage
    {
        try {
            return $this->walk($data);
        } catch (\OutOfRangeException) {
            throw ImageRejected::unsupportedType('webp_invalid', 'WebP ends inside a chunk.');
        }
    }

    public static function effectiveDurationMs(int $durationMs): int
    {
        return $durationMs < self::MIN_DURATION_MS ? self::DEFAULT_DURATION_MS : $durationMs;
    }

    public static function chunk(string $fourcc, string $payload): string
    {
        $size = strlen($payload);

        return $fourcc . Bytes::pack32le($size) . $payload . ($size % 2 === 1 ? "\0" : '');
    }

    public static function riff(string $chunks): string
    {
        return 'RIFF' . Bytes::pack32le(4 + strlen($chunks)) . 'WEBP' . $chunks;
    }

    private function walk(string $data): ParsedImage
    {
        if (substr($data, 0, 4) !== 'RIFF' || substr($data, 8, 4) !== 'WEBP') {
            throw ImageRejected::unsupportedType('webp_invalid', 'Missing RIFF/WEBP header.');
        }
        if (Bytes::u32le($data, 4) + 8 !== strlen($data)) {
            throw ImageRejected::unsupportedType('webp_size_mismatch', 'RIFF size does not match the file size.');
        }
        $chunks = $this->chunks($data, 12, strlen($data));
        if ($chunks === []) {
            throw ImageRejected::unsupportedType('webp_invalid', 'WebP without chunk.');
        }
        [$fourcc, $offset, $size] = $chunks[0];
        if ($fourcc === 'VP8 ' || $fourcc === 'VP8L') {
            [$width, $height] = self::bitstreamSize($fourcc, Bytes::slice($data, $offset, $size));

            return new ParsedImage(
                $width,
                $height,
                lossless: $fourcc === 'VP8L',
                cleanData: self::riff(self::chunk($fourcc, Bytes::slice($data, $offset, $size))),
                opaqueRanges: [[$offset, $size]],
            );
        }
        if ($fourcc !== 'VP8X' || $size < 10) {
            throw ImageRejected::unsupportedType('webp_invalid', 'Unknown first WebP chunk.');
        }

        return $this->extended($data, $chunks);
    }

    /**
     * @param list<array{0: string, 1: int, 2: int}> $chunks
     */
    private function extended(string $data, array $chunks): ParsedImage
    {
        [, $offset] = $chunks[0];
        $flags = Bytes::u8($data, $offset);
        $canvasWidth = 1 + Bytes::u24le($data, $offset + 4);
        $canvasHeight = 1 + Bytes::u24le($data, $offset + 7);
        $animated = ($flags & self::FLAG_ANIMATION) !== 0;
        $kept = '';
        $opaque = [];
        $hasAnim = false;
        $frames = 0;
        $durationMs = 0;
        $still = null;
        $firstFrame = null;
        $lossless = false;
        foreach (array_slice($chunks, 1) as [$fourcc, $chunkOffset, $size]) {
            $payload = Bytes::slice($data, $chunkOffset, $size);
            switch ($fourcc) {
                case 'ANIM':
                    if ($size < 6 || $hasAnim) {
                        throw ImageRejected::unsupportedType('webp_invalid', 'Invalid ANIM chunk.');
                    }
                    $hasAnim = true;
                    $kept .= self::chunk('ANIM', $payload);
                    break;
                case 'ANMF':
                    $frame = $this->frame($data, $chunkOffset, $size, $canvasWidth, $canvasHeight, $opaque);
                    $frames++;
                    $durationMs += self::effectiveDurationMs($frame['duration']);
                    $firstFrame ??= $frame['static'];
                    $kept .= self::chunk('ANMF', $frame['payload']);
                    break;
                case 'ALPH':
                case 'VP8 ':
                case 'VP8L':
                    if ($fourcc !== 'ALPH') {
                        if ($still !== null) {
                            throw ImageRejected::unsupportedType('webp_invalid', 'Several image bitstreams.');
                        }
                        $still = self::bitstreamSize($fourcc, $payload);
                        $lossless = $fourcc === 'VP8L';
                    }
                    $opaque[] = [$chunkOffset, $size];
                    $kept .= self::chunk($fourcc, $payload);
                    break;
                default:
                    // EXIF, "XMP ", ICCP and unknown chunks are dropped.
                    break;
            }
        }
        if ($animated) {
            if (!$hasAnim || $frames === 0 || $still !== null) {
                throw ImageRejected::unsupportedType('webp_invalid', 'Animated WebP without ANIM/ANMF.');
            }
        } elseif ($still === null || $frames > 0 || $hasAnim) {
            throw ImageRejected::unsupportedType('webp_invalid', 'Still WebP without a single bitstream.');
        }
        if ($still !== null && ($still[0] !== $canvasWidth || $still[1] !== $canvasHeight)) {
            throw ImageRejected::unsupportedType('webp_invalid', 'Bitstream size differs from the canvas.');
        }
        $newFlags = $flags & (self::FLAG_ALPHA | self::FLAG_ANIMATION);
        $vp8x = chr($newFlags) . "\0\0\0" . Bytes::pack24le($canvasWidth - 1) . Bytes::pack24le($canvasHeight - 1);

        return new ParsedImage(
            $canvasWidth,
            $canvasHeight,
            frameCount: $animated ? $frames : 1,
            durationMs: $animated && $frames > 1 ? $durationMs : 0,
            animated: $animated,
            lossless: $lossless,
            cleanData: self::riff(self::chunk('VP8X', $vp8x) . $kept),
            opaqueRanges: $opaque,
            firstFrame: $firstFrame,
        );
    }

    /**
     * @param list<array{0: int, 1: int}> $opaque
     * @return array{duration: int, payload: string, static: array{data: string, x: int, y: int, canvasWidth: int, canvasHeight: int}}
     */
    private function frame(string $data, int $offset, int $size, int $canvasWidth, int $canvasHeight, array &$opaque): array
    {
        if ($size < 16) {
            throw ImageRejected::unsupportedType('webp_invalid', 'ANMF chunk too short.');
        }
        $x = 2 * Bytes::u24le($data, $offset);
        $y = 2 * Bytes::u24le($data, $offset + 3);
        $width = 1 + Bytes::u24le($data, $offset + 6);
        $height = 1 + Bytes::u24le($data, $offset + 9);
        $duration = Bytes::u24le($data, $offset + 12);
        if ($x + $width > $canvasWidth || $y + $height > $canvasHeight) {
            throw ImageRejected::unsupportedType('webp_invalid', 'ANMF frame outside the canvas.');
        }
        $payload = Bytes::slice($data, $offset, 16);
        $alpha = null;
        $bitstream = null;
        foreach ($this->chunks($data, $offset + 16, $offset + $size) as [$fourcc, $chunkOffset, $chunkSize]) {
            $body = Bytes::slice($data, $chunkOffset, $chunkSize);
            if ($fourcc === 'ALPH' && $alpha === null && $bitstream === null) {
                $alpha = $body;
            } elseif (($fourcc === 'VP8 ' || $fourcc === 'VP8L') && $bitstream === null) {
                [$bw, $bh] = self::bitstreamSize($fourcc, $body);
                if ($bw !== $width || $bh !== $height) {
                    throw ImageRejected::unsupportedType('webp_invalid', 'ANMF bitstream size mismatch.');
                }
                $bitstream = [$fourcc, $body];
            } elseif ($fourcc === 'ALPH' || $fourcc === 'VP8 ' || $fourcc === 'VP8L') {
                throw ImageRejected::unsupportedType('webp_invalid', 'Unexpected chunk order in ANMF.');
            } else {
                continue;
            }
            $opaque[] = [$chunkOffset, $chunkSize];
        }
        if ($bitstream === null) {
            throw ImageRejected::unsupportedType('webp_invalid', 'ANMF without bitstream.');
        }
        if ($bitstream[0] === 'VP8L') {
            $alpha = null;
        }
        $payload .= ($alpha !== null ? self::chunk('ALPH', $alpha) : '') . self::chunk($bitstream[0], $bitstream[1]);
        if ($alpha !== null) {
            $vp8x = chr(self::FLAG_ALPHA) . "\0\0\0" . Bytes::pack24le($width - 1) . Bytes::pack24le($height - 1);
            $static = self::riff(self::chunk('VP8X', $vp8x) . self::chunk('ALPH', $alpha) . self::chunk('VP8 ', $bitstream[1]));
        } else {
            $static = self::riff(self::chunk($bitstream[0], $bitstream[1]));
        }

        return [
            'duration' => $duration,
            'payload' => $payload,
            'static' => ['data' => $static, 'x' => $x, 'y' => $y, 'canvasWidth' => $canvasWidth, 'canvasHeight' => $canvasHeight],
        ];
    }

    /**
     * @return list<array{0: string, 1: int, 2: int}> [fourcc, payload offset, payload size]
     */
    private function chunks(string $data, int $offset, int $end): array
    {
        $chunks = [];
        while ($offset < $end) {
            if ($offset + 8 > $end) {
                throw ImageRejected::unsupportedType('webp_invalid', 'Truncated chunk header.');
            }
            $fourcc = substr($data, $offset, 4);
            $size = Bytes::u32le($data, $offset + 4);
            $padded = $size + ($size % 2);
            if ($offset + 8 + $padded > $end) {
                throw ImageRejected::unsupportedType('webp_invalid', "Chunk {$fourcc} exceeds its container.");
            }
            $chunks[] = [$fourcc, $offset + 8, $size];
            $offset += 8 + $padded;
        }

        return $chunks;
    }

    /**
     * Width and height announced by a VP8 (lossy key frame) or VP8L (lossless) bitstream.
     *
     * @return array{0: int, 1: int}
     */
    public static function bitstreamSize(string $fourcc, string $payload): array
    {
        if ($fourcc === 'VP8 ') {
            if (
                strlen($payload) < 10 || (ord($payload[0]) & 0x01) !== 0
                || substr($payload, 3, 3) !== "\x9D\x01\x2A"
            ) {
                throw ImageRejected::unsupportedType('webp_invalid', 'Invalid VP8 key frame header.');
            }

            return [Bytes::u16le($payload, 6) & 0x3FFF, Bytes::u16le($payload, 8) & 0x3FFF];
        }
        if (strlen($payload) < 5 || ord($payload[0]) !== 0x2F) {
            throw ImageRejected::unsupportedType('webp_invalid', 'Invalid VP8L header.');
        }
        $bits = Bytes::u32le($payload, 1);

        return [1 + ($bits & 0x3FFF), 1 + (($bits >> 14) & 0x3FFF)];
    }
}
