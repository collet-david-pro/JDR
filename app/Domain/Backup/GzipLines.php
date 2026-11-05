<?php

declare(strict_types=1);

namespace JDR\Domain\Backup;

defined('JDR_BOOT') || exit;

/**
 * Reads the lines of a (multi-member) gzip file and can stop and resume at any line, across requests.
 * Position = {raw: compressed offset where the current gzip member starts, skip: uncompressed bytes of
 * that member already handled}. SqlBackup writes one small member per slice, so resuming costs little;
 * a single-member file still works (the member is decompressed again up to "skip").
 * Every member's CRC is checked by zlib; a truncated or corrupt file throws backup.invalid_file.
 */
final class GzipLines
{
    private const READ = 65536;

    /**
     * Tells whether the file starts with the gzip magic bytes.
     */
    public static function isGzip(string $path): bool
    {
        $h = @fopen($path, 'rb');
        if ($h === false) {
            return false;
        }
        $magic = fread($h, 2);
        fclose($h);

        return $magic === "\x1f\x8b";
    }

    /**
     * Calls $line for each line (without "\n" / "\r\n") from $raw/$skip; after each line, $stop() true
     * ends the call. Returns the position after the last handled line and whether the end was reached.
     *
     * @param \Closure(string): void $line
     * @param \Closure(): bool       $stop
     * @return array{raw:int, skip:int, eof:bool}
     */
    public static function each(string $path, int $raw, int $skip, \Closure $line, \Closure $stop): array
    {
        $h = @fopen($path, 'rb');
        if ($h === false) {
            throw BackupException::invalid('unreadable');
        }
        try {
            $size = (int) fstat($h)['size'];
            while ($raw < $size) {
                if (fseek($h, $raw) !== 0) {
                    throw BackupException::invalid('unreadable');
                }
                $ctx = inflate_init(ZLIB_ENCODING_GZIP);
                if ($ctx === false) {
                    throw new \RuntimeException('zlib is not available.');
                }
                $produced = 0;    // uncompressed bytes of this member so far
                $bufStart = $skip; // member offset of $buffer[0]
                $buffer = '';
                $ended = false;
                while (!$ended) {
                    $chunk = fread($h, self::READ);
                    if ($chunk === false || $chunk === '') {
                        throw BackupException::invalid('truncated');
                    }
                    $out = @inflate_add($ctx, $chunk, ZLIB_SYNC_FLUSH);
                    if ($out === false) {
                        throw BackupException::invalid('corrupt');
                    }
                    $ended = inflate_get_status($ctx) === ZLIB_STREAM_END;
                    $from = $produced;
                    $produced += strlen($out);
                    if ($produced <= $skip) {
                        if ($ended && $produced < $skip) {
                            throw BackupException::invalid('corrupt');
                        }
                        continue; // a member ending exactly at $skip: on to the next one
                    }
                    $buffer .= $from < $skip ? substr($out, $skip - $from) : $out;
                    $offset = 0;
                    while (($nl = strpos($buffer, "\n", $offset)) !== false) {
                        $line(rtrim(substr($buffer, $offset, $nl - $offset), "\r"));
                        $offset = $nl + 1;
                        if ($stop()) {
                            $at = $bufStart + $offset;
                            if ($ended && $at === $produced) {
                                $next = $raw + inflate_get_read_len($ctx);

                                return ['raw' => $next, 'skip' => 0, 'eof' => $next >= $size];
                            }

                            return ['raw' => $raw, 'skip' => $at, 'eof' => false];
                        }
                    }
                    $buffer = substr($buffer, $offset);
                    $bufStart += $offset;
                }
                $raw += inflate_get_read_len($ctx);
                $skip = 0;
                if ($buffer !== '') {
                    // Last line without "\n" (members written by SqlBackup always end a line).
                    $line(rtrim($buffer, "\r"));
                    if ($stop()) {
                        return ['raw' => $raw, 'skip' => 0, 'eof' => $raw >= $size];
                    }
                }
            }

            return ['raw' => $raw, 'skip' => 0, 'eof' => true];
        } finally {
            fclose($h);
        }
    }

    /**
     * First line of the file, or null when it is not readable as gzip.
     */
    public static function firstLine(string $path): ?string
    {
        if (!self::isGzip($path)) {
            return null;
        }
        $first = null;
        try {
            self::each($path, 0, 0, static function (string $l) use (&$first): void {
                $first = $l;
            }, static fn (): bool => true);
        } catch (BackupException) {
            return null;
        }

        return $first;
    }
}
