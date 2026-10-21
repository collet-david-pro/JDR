<?php

declare(strict_types=1);

namespace JDR\Imaging;

defined('JDR_BOOT') || exit;

/**
 * Refuses files carrying script or markup payloads (projet.md 21 and 23: the trapped corpus
 * must be entirely refused, even when re-encoding would neutralise it).
 *
 * Patterns (case-insensitive): <?php, <?=, <script, <html, <svg, <!doctype.
 * - Long patterns (>= 5 bytes) are searched in the whole raw file: their probability of
 *   appearing by chance in compressed data is negligible (< 1e-4 for a 10 MB file).
 * - Short patterns ("<?=" and "<svg") would appear by chance in compressed pixel data (about
 *   0.6 expected "<?=" in 10 MB of random bytes): they are searched everywhere EXCEPT in the
 *   compressed pixel data reported by the parsers (IDAT/fdAT, JPEG scans, GIF LZW blocks,
 *   VP8/VP8L/ALPH), i.e. in headers, metadata, comments and trailing bytes.
 */
final class TrapScanner
{
    public const LONG_PATTERNS = ['<?php', '<script', '<html', '<!doctype'];
    public const SHORT_PATTERNS = ['<?=', '<svg'];

    /**
     * @param list<array{0: int, 1: int}> $opaqueRanges [offset, length] of compressed pixel data
     * @throws ImageRejected unsupported_type
     */
    public function scan(string $data, array $opaqueRanges = []): void
    {
        foreach (self::LONG_PATTERNS as $pattern) {
            if (stripos($data, $pattern) !== false) {
                throw self::rejected($pattern);
            }
        }
        $visible = self::withoutRanges($data, $opaqueRanges);
        foreach (self::SHORT_PATTERNS as $pattern) {
            if (stripos($visible, $pattern) !== false) {
                throw self::rejected($pattern);
            }
        }
    }

    /**
     * Concatenation of the bytes outside the given ranges, pieces separated by a NUL byte so
     * that a pattern cannot be formed across a removed range.
     *
     * @param list<array{0: int, 1: int}> $ranges
     */
    public static function withoutRanges(string $data, array $ranges): string
    {
        usort($ranges, static fn (array $a, array $b): int => $a[0] <=> $b[0]);
        $pieces = [];
        $cursor = 0;
        foreach ($ranges as [$offset, $length]) {
            if ($offset > $cursor) {
                $pieces[] = substr($data, $cursor, $offset - $cursor);
            }
            $cursor = max($cursor, $offset + $length);
        }
        $pieces[] = (string) substr($data, $cursor);

        return implode("\0", $pieces);
    }

    private static function rejected(string $pattern): ImageRejected
    {
        return ImageRejected::unsupportedType('script_payload', sprintf('File contains "%s".', $pattern));
    }
}
