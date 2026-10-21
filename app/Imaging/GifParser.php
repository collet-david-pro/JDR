<?php

declare(strict_types=1);

namespace JDR\Imaging;

defined('JDR_BOOT') || exit;

/**
 * GIF block walk and rewrite (projet.md 11.3 step 5).
 *
 * - Counts images (image descriptors) and the total duration from the graphic control
 *   extensions. Like browsers (Chrome, Firefox, Safari), a delay of 0 or 1 centisecond is
 *   played as 10 cs (100 ms): the duration is computed the same way, so that a GIF announcing
 *   "0 ms" frames cannot bypass max_animation_ms.
 * - Rewrites the file keeping only: header, logical screen descriptor, global colour table,
 *   the first NETSCAPE2.0 application extension (loop count), graphic control extensions
 *   attached to an image, image descriptors with their colour tables and LZW data, trailer.
 *   Comment extensions, other application extensions (XMP, ICC...), plain text extensions
 *   (with their graphic control extension) and unknown extensions are dropped; bytes after the
 *   trailer are dropped.
 * - Any structural error (truncated sub-blocks, unknown block, missing trailer, no image)
 *   refuses the file.
 */
final class GifParser
{
    /** Browser rule: delays <= 1 cs are played as 10 cs. */
    public const MIN_DELAY_CS = 2;
    public const DEFAULT_DELAY_CS = 10;

    /**
     * @throws ImageRejected unsupported_type
     */
    public function parse(string $data): ParsedImage
    {
        try {
            return $this->walk($data);
        } catch (\OutOfRangeException) {
            throw ImageRejected::unsupportedType('gif_invalid', 'GIF ends inside a block.');
        }
    }

    public static function effectiveDelayCs(int $delayCs): int
    {
        return $delayCs < self::MIN_DELAY_CS ? self::DEFAULT_DELAY_CS : $delayCs;
    }

    private function walk(string $data): ParsedImage
    {
        $version = substr($data, 0, 6);
        if ($version !== 'GIF87a' && $version !== 'GIF89a') {
            throw ImageRejected::unsupportedType('gif_invalid', 'Missing GIF signature.');
        }
        $width = Bytes::u16le($data, 6);
        $height = Bytes::u16le($data, 8);
        $packed = Bytes::u8($data, 10);
        $pos = 13;
        if ($packed & 0x80) {
            $pos += 3 << (($packed & 0x07) + 1);
        }
        $out = Bytes::slice($data, 0, $pos);
        $frames = 0;
        $durationCs = 0;
        $pendingGce = null;
        $pendingDelay = 0;
        $loopKept = false;
        $opaque = [];
        while (true) {
            $block = Bytes::u8($data, $pos);
            if ($block === 0x3B) {
                $out .= "\x3B";
                break;
            }
            if ($block === 0x21) {
                $label = Bytes::u8($data, $pos + 1);
                $start = $pos;
                $pos += 2;
                if ($label === 0xF9) {
                    if (Bytes::u8($data, $pos) !== 4 || Bytes::u8($data, $pos + 5) !== 0) {
                        throw ImageRejected::unsupportedType('gif_invalid', 'Invalid graphic control extension.');
                    }
                    $pendingDelay = Bytes::u16le($data, $pos + 2);
                    $pos += 6;
                    $pendingGce = Bytes::slice($data, $start, $pos - $start);
                    continue;
                }
                $isLoop = $label === 0xFF && Bytes::u8($data, $pos) === 11
                    && Bytes::slice($data, $pos + 1, 11) === 'NETSCAPE2.0';
                $pos = $this->skipSubBlocks($data, $pos);
                if ($isLoop && !$loopKept) {
                    $out .= Bytes::slice($data, $start, $pos - $start);
                    $loopKept = true;
                } elseif ($label === 0x01) {
                    $pendingGce = null;
                }
                continue;
            }
            if ($block === 0x2C) {
                $start = $pos;
                $local = Bytes::u8($data, $pos + 9);
                $pos += 10;
                if ($local & 0x80) {
                    $pos += 3 << (($local & 0x07) + 1);
                }
                $lzw = Bytes::u8($data, $pos);
                if ($lzw < 1 || $lzw > 11) {
                    throw ImageRejected::unsupportedType('gif_invalid', 'Invalid LZW minimum code size.');
                }
                $dataStart = $pos + 1;
                $pos = $this->skipSubBlocks($data, $dataStart);
                $opaque[] = [$dataStart, $pos - $dataStart];
                $out .= ($pendingGce ?? '') . Bytes::slice($data, $start, $pos - $start);
                $frames++;
                $durationCs += self::effectiveDelayCs($pendingGce !== null ? $pendingDelay : 0);
                $pendingGce = null;
                continue;
            }
            throw ImageRejected::unsupportedType('gif_invalid', sprintf('Unknown GIF block 0x%02X.', $block));
        }
        if ($frames === 0) {
            throw ImageRejected::unsupportedType('gif_no_frame', 'GIF without image.');
        }
        $animated = $frames > 1;

        return new ParsedImage(
            $width,
            $height,
            frameCount: $frames,
            durationMs: $animated ? $durationCs * 10 : 0,
            animated: $animated,
            cleanData: $out,
            opaqueRanges: $opaque,
        );
    }

    /** Skips a sequence of data sub-blocks and its terminator; returns the next offset. */
    private function skipSubBlocks(string $data, int $pos): int
    {
        while (true) {
            $size = Bytes::u8($data, $pos);
            $pos++;
            if ($size === 0) {
                return $pos;
            }
            Bytes::slice($data, $pos, $size);
            $pos += $size;
        }
    }
}
