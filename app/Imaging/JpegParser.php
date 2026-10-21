<?php

declare(strict_types=1);

namespace JDR\Imaging;

defined('JDR_BOOT') || exit;

/**
 * JPEG structure check: SOI, marker segments, a frame header (SOF), at least one scan (SOS)
 * whose entropy-coded data is skipped, and a mandatory EOI (a missing EOI = truncated file).
 * Also reads the EXIF orientation (APP1 "Exif") without the exif extension.
 */
final class JpegParser
{
    /**
     * @throws ImageRejected unsupported_type
     */
    public function parse(string $data): ParsedImage
    {
        try {
            return $this->walk($data);
        } catch (\OutOfRangeException) {
            throw ImageRejected::unsupportedType('jpeg_truncated', 'JPEG ends inside a segment.');
        }
    }

    private function walk(string $data): ParsedImage
    {
        if (!str_starts_with($data, "\xFF\xD8")) {
            throw ImageRejected::unsupportedType('jpeg_invalid', 'Missing SOI marker.');
        }
        $length = strlen($data);
        $offset = 2;
        $width = $height = 0;
        $orientation = 1;
        $scans = 0;
        $opaque = [];
        while (true) {
            if (Bytes::u8($data, $offset) !== 0xFF) {
                throw ImageRejected::unsupportedType('jpeg_invalid', 'Marker expected.');
            }
            while (Bytes::u8($data, $offset) === 0xFF) {
                $offset++;
            }
            $marker = Bytes::u8($data, $offset);
            $offset++;
            if ($marker === 0xD9) {
                break;
            }
            if (($marker >= 0xD0 && $marker <= 0xD7) || $marker === 0x01) {
                continue;
            }
            if ($marker === 0x00 || $marker === 0xD8) {
                throw ImageRejected::unsupportedType('jpeg_invalid', 'Unexpected marker.');
            }
            $size = Bytes::u16be($data, $offset);
            if ($size < 2) {
                throw ImageRejected::unsupportedType('jpeg_invalid', 'Invalid segment length.');
            }
            $body = Bytes::slice($data, $offset + 2, $size - 2);
            $offset += $size;
            if ($marker >= 0xC0 && $marker <= 0xCF && !in_array($marker, [0xC4, 0xC8, 0xCC], true)) {
                $height = Bytes::u16be($body, 1);
                $width = Bytes::u16be($body, 3);
            } elseif ($marker === 0xE1 && str_starts_with($body, "Exif\0\0")) {
                $orientation = self::orientation(substr($body, 6)) ?? $orientation;
            } elseif ($marker === 0xDA) {
                if ($width === 0) {
                    throw ImageRejected::unsupportedType('jpeg_invalid', 'Scan before frame header.');
                }
                $scans++;
                $start = $offset;
                $offset = $this->skipEntropyData($data, $offset, $length);
                $opaque[] = [$start, $offset - $start];
            }
        }
        if ($scans === 0 || $width < 1 || $height < 1) {
            throw ImageRejected::unsupportedType('jpeg_invalid', 'JPEG without frame or scan.');
        }

        return new ParsedImage($width, $height, orientation: $orientation, opaqueRanges: $opaque);
    }

    /** Returns the offset of the marker ending the entropy-coded segment. */
    private function skipEntropyData(string $data, int $offset, int $length): int
    {
        while (true) {
            $pos = strpos($data, "\xFF", $offset);
            if ($pos === false || $pos + 1 >= $length) {
                throw new \OutOfRangeException('Unterminated scan.');
            }
            $next = ord($data[$pos + 1]);
            if ($next === 0x00 || ($next >= 0xD0 && $next <= 0xD7) || $next === 0xFF) {
                $offset = $pos + ($next === 0xFF ? 1 : 2);
                continue;
            }

            return $pos;
        }
    }

    /** EXIF orientation (1-8) from a TIFF block, null when absent or unreadable. */
    public static function orientation(string $tiff): ?int
    {
        try {
            $order = substr($tiff, 0, 2);
            if ($order !== 'II' && $order !== 'MM') {
                return null;
            }
            $u16 = $order === 'II' ? Bytes::u16le(...) : Bytes::u16be(...);
            $u32 = $order === 'II' ? Bytes::u32le(...) : Bytes::u32be(...);
            if ($u16($tiff, 2) !== 42) {
                return null;
            }
            $ifd = $u32($tiff, 4);
            $count = $u16($tiff, $ifd);
            for ($i = 0; $i < min($count, 1000); $i++) {
                $entry = $ifd + 2 + $i * 12;
                if ($u16($tiff, $entry) === 0x0112) {
                    $value = $u16($tiff, $entry + 8);

                    return $value >= 1 && $value <= 8 ? $value : null;
                }
            }
        } catch (\OutOfRangeException) {
            return null;
        }

        return null;
    }
}
