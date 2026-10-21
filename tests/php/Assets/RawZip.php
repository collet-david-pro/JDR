<?php

declare(strict_types=1);

namespace JDR\Tests\Assets;

/**
 * Builds raw ZIP bytes without any check (malicious archives for the tests).
 */
final class RawZip
{
    /**
     * Hand-made archive: no checks, every field overridable.
     *
     * @param list<array<string, mixed>> $entries
     */
    public static function build(array $entries): string
    {
        $out = '';
        $central = '';
        foreach ($entries as $e) {
            $name = (string) $e['name'];
            $data = (string) ($e['data'] ?? 'data');
            $method = (int) ($e['method'] ?? 0);
            $payload = $method === 8 ? (string) gzdeflate($data) : $data;
            $crc = (int) ($e['crc'] ?? crc32($data));
            $size = (int) ($e['size'] ?? strlen($data));
            $flags = (int) ($e['flags'] ?? 0);
            $offset = strlen($out);
            $out .= pack('VvvvvvVVVvv', 0x04034b50, 20, $flags, $method, 0, 0x21, $crc, strlen($payload), $size, strlen($name), 0) . $name . $payload;
            $central .= pack('VvvvvvvVVVvvvvvVV', 0x02014b50, (3 << 8) | 20, 20, $flags, $method, 0, 0x21, $crc, strlen($payload), $size, strlen($name), 0, 0, 0, 0, (int) ($e['attr'] ?? (0100644 << 16)), $offset) . $name;
        }

        return $out . $central . pack('VvvvvVVv', 0x06054b50, 0, 0, count($entries), count($entries), strlen($central), strlen($out), 0);
    }
}
