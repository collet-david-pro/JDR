<?php

declare(strict_types=1);

namespace JDR\Imaging;

defined('JDR_BOOT') || exit;

/**
 * PNG structure check: signature, chunk walk with CRC verification, IHDR first, at least one
 * IDAT, IEND mandatory (a missing IEND means a truncated file). APNG (acTL) is detected and
 * handled as a static image by the pipeline (projet.md Q5: first/default image re-encoded).
 * Bytes after IEND are tolerated here: they never survive the re-encoding, and the trap scan
 * refuses script-like payloads.
 */
final class PngParser
{
    private const SIGNATURE = "\x89PNG\r\n\x1A\n";
    private const VALID_DEPTHS = [0 => [1, 2, 4, 8, 16], 2 => [8, 16], 3 => [1, 2, 4, 8], 4 => [8, 16], 6 => [8, 16]];

    /**
     * @throws ImageRejected unsupported_type
     */
    public function parse(string $data): ParsedImage
    {
        try {
            return $this->walk($data);
        } catch (\OutOfRangeException) {
            throw ImageRejected::unsupportedType('png_truncated', 'PNG ends inside a chunk.');
        }
    }

    private function walk(string $data): ParsedImage
    {
        if (!str_starts_with($data, self::SIGNATURE)) {
            throw ImageRejected::unsupportedType('png_invalid', 'Missing PNG signature.');
        }
        $offset = 8;
        $width = $height = 0;
        $isApng = false;
        $idat = 0;
        $opaque = [];
        $first = true;
        $ended = false;
        $length = strlen($data);
        while ($offset < $length) {
            $size = Bytes::u32be($data, $offset);
            $type = Bytes::slice($data, $offset + 4, 4);
            if ($size > 0x7FFFFFFF || !preg_match('/^[A-Za-z]{4}$/', $type)) {
                throw ImageRejected::unsupportedType('png_invalid', 'Invalid PNG chunk header.');
            }
            $body = Bytes::slice($data, $offset + 8, $size);
            $crc = Bytes::u32be($data, $offset + 8 + $size);
            if ((crc32($type . $body) & 0xFFFFFFFF) !== $crc) {
                throw ImageRejected::unsupportedType('png_bad_crc', "Bad CRC in chunk {$type}.");
            }
            if ($first) {
                if ($type !== 'IHDR' || $size !== 13) {
                    throw ImageRejected::unsupportedType('png_invalid', 'First PNG chunk is not IHDR.');
                }
                [$width, $height] = $this->header($body);
                $first = false;
            } elseif ($type === 'IHDR') {
                throw ImageRejected::unsupportedType('png_invalid', 'Duplicate IHDR.');
            }
            if ($type === 'acTL') {
                $isApng = true;
            } elseif ($type === 'IDAT' || $type === 'fdAT') {
                $idat += $type === 'IDAT' ? 1 : 0;
                $opaque[] = [$offset + 8, $size];
            }
            $offset += 12 + $size;
            if ($type === 'IEND') {
                $ended = true;
                break;
            }
        }
        if (!$ended) {
            throw ImageRejected::unsupportedType('png_truncated', 'PNG has no IEND chunk.');
        }
        if ($idat === 0) {
            throw ImageRejected::unsupportedType('png_invalid', 'PNG has no IDAT chunk.');
        }

        return new ParsedImage($width, $height, isApng: $isApng, opaqueRanges: $opaque);
    }

    /**
     * @return array{0: int, 1: int}
     */
    private function header(string $body): array
    {
        $width = Bytes::u32be($body, 0);
        $height = Bytes::u32be($body, 4);
        $depth = ord($body[8]);
        $colorType = ord($body[9]);
        if (
            $width < 1 || $height < 1 || $width > 0x7FFFFFFF || $height > 0x7FFFFFFF
            || !in_array($depth, self::VALID_DEPTHS[$colorType] ?? [], true)
            || ord($body[10]) !== 0 || ord($body[11]) !== 0 || ord($body[12]) > 1
        ) {
            throw ImageRejected::unsupportedType('png_invalid', 'Invalid IHDR.');
        }

        return [$width, $height];
    }
}
