<?php

declare(strict_types=1);

namespace JDR\Zip;

defined('JDR_BOOT') || exit;

/**
 * Streaming ZIP writer in pure PHP (no ZIP64: < 65 535 entries, < 4 GiB).
 *
 * Resumable across requests (background jobs run in slices): state() returns the write offset
 * and the central directory records written so far; resume() reopens the file, cuts anything
 * written after that offset (interrupted slice) and continues. finish() writes the central directory.
 * Files are stored (images are already compressed); strings may be deflated.
 */
final class ZipWriter
{
    private const MAX_ENTRIES = 65535;
    private const MAX_OFFSET = 0xFFFFFFFE;

    /** @var resource */
    private $handle;

    /**
     * @param list<array{name: string, method: int, crc: int, csize: int, size: int, offset: int, time: int, date: int}> $entries
     */
    private function __construct(private string $path, private int $offset, private array $entries)
    {
        $handle = @fopen($path, 'c+b');
        if ($handle === false) {
            throw new ZipException('write_failed', 'Cannot open the ZIP file for writing.');
        }
        $this->handle = $handle;
        ftruncate($this->handle, $offset);
        fseek($this->handle, $offset);
    }

    public function __destruct()
    {
        $this->close();
    }

    public static function create(string $path): self
    {
        return new self($path, 0, []);
    }

    /**
     * @param array{offset?: mixed, entries?: mixed} $state from state()
     */
    public static function resume(string $path, array $state): self
    {
        $offset = $state['offset'] ?? null;
        $entries = $state['entries'] ?? null;
        if (!is_int($offset) || !is_array($entries) || !is_file($path) || filesize($path) < $offset) {
            throw new ZipException('corrupt', 'Invalid ZIP writer state.');
        }
        $list = [];
        foreach ($entries as $e) {
            if (!is_array($e) || !is_string($e['name'] ?? null)) {
                throw new ZipException('corrupt', 'Invalid ZIP writer state.');
            }
            $list[] = [
                'name' => $e['name'],
                'method' => (int) ($e['method'] ?? 0),
                'crc' => (int) ($e['crc'] ?? 0),
                'csize' => (int) ($e['csize'] ?? 0),
                'size' => (int) ($e['size'] ?? 0),
                'offset' => (int) ($e['offset'] ?? 0),
                'time' => (int) ($e['time'] ?? 0),
                'date' => (int) ($e['date'] ?? 0),
            ];
        }

        return new self($path, $offset, $list);
    }

    /**
     * @return array{offset: int, entries: list<array{name: string, method: int, crc: int, csize: int, size: int, offset: int, time: int, date: int}>}
     */
    public function state(): array
    {
        return ['offset' => $this->offset, 'entries' => $this->entries];
    }

    public function count(): int
    {
        return count($this->entries);
    }

    public function has(string $name): bool
    {
        foreach ($this->entries as $entry) {
            if ($entry['name'] === $name) {
                return true;
            }
        }

        return false;
    }

    /**
     * Adds a file from disk, stored without compression.
     */
    public function addFile(string $name, string $source, ?int $mtime = null): void
    {
        $size = @filesize($source);
        $crc = @hash_file('crc32b', $source);
        if ($size === false || $crc === false) {
            throw new ZipException('unreadable', 'Source file is not readable.');
        }
        $in = @fopen($source, 'rb');
        if ($in === false) {
            throw new ZipException('unreadable', 'Source file is not readable.');
        }
        try {
            $this->writeEntry($name, 0, (int) hexdec($crc), $size, $size, $mtime ?? (int) filemtime($source), function () use ($in): void {
                while (!feof($in)) {
                    $chunk = fread($in, 65536);
                    if ($chunk === false || $chunk === '') {
                        break;
                    }
                    $this->write($chunk);
                }
            });
        } finally {
            fclose($in);
        }
    }

    public function addString(string $name, string $data, bool $compress = true, ?int $mtime = null): void
    {
        $method = 0;
        $payload = $data;
        if ($compress && function_exists('gzdeflate')) {
            $deflated = gzdeflate($data, 6);
            if (is_string($deflated) && strlen($deflated) < strlen($data)) {
                $method = 8;
                $payload = $deflated;
            }
        }
        $this->writeEntry($name, $method, crc32($data), strlen($payload), strlen($data), $mtime ?? time(), function () use ($payload): void {
            $this->write($payload);
        });
    }

    /**
     * Writes the central directory and closes the file.
     */
    public function finish(): void
    {
        $start = $this->offset;
        foreach ($this->entries as $e) {
            $this->write(pack(
                'VvvvvvvVVVvvvvvVV',
                0x02014b50,
                (3 << 8) | 20,
                20,
                0x0800,
                $e['method'],
                $e['time'],
                $e['date'],
                $e['crc'],
                $e['csize'],
                $e['size'],
                strlen($e['name']),
                0,
                0,
                0,
                0,
                0100644 << 16,
                $e['offset'],
            ) . $e['name']);
        }
        $size = $this->offset - $start;
        if ($this->offset > self::MAX_OFFSET) {
            throw new ZipException('zip64_unsupported', 'ZIP archive too large.');
        }
        $count = count($this->entries);
        $this->write(pack('VvvvvVVv', 0x06054b50, 0, 0, $count, $count, $size, $start, 0));
        fflush($this->handle);
        $this->close();
    }

    public function close(): void
    {
        if (is_resource($this->handle)) {
            fclose($this->handle);
        }
    }

    /**
     * @param \Closure(): void $writeData
     */
    private function writeEntry(string $name, int $method, int $crc, int $csize, int $size, int $mtime, \Closure $writeData): void
    {
        ZipReader::checkName($name);
        if ($this->has($name)) {
            throw new ZipException('duplicate_entry', 'Duplicate ZIP entry name.');
        }
        if (count($this->entries) >= self::MAX_ENTRIES || $this->offset + 30 + strlen($name) + $csize > self::MAX_OFFSET) {
            throw new ZipException('zip64_unsupported', 'ZIP archive too large.');
        }
        [$time, $date] = self::dosTime($mtime);
        $offset = $this->offset;
        $this->write(pack('VvvvvvVVVvv', 0x04034b50, 20, 0x0800, $method, $time, $date, $crc, $csize, $size, strlen($name), 0) . $name);
        $writeData();
        if ($this->offset !== $offset + 30 + strlen($name) + $csize) {
            throw new ZipException('write_failed', 'Source file changed while being archived.');
        }
        $this->entries[] = [
            'name' => $name,
            'method' => $method,
            'crc' => $crc,
            'csize' => $csize,
            'size' => $size,
            'offset' => $offset,
            'time' => $time,
            'date' => $date,
        ];
    }

    private function write(string $data): void
    {
        $length = strlen($data);
        if ($length === 0) {
            return;
        }
        if (fwrite($this->handle, $data) !== $length) {
            throw new ZipException('write_failed', 'Cannot write the ZIP file.');
        }
        $this->offset += $length;
    }

    /**
     * @return array{0: int, 1: int} DOS time, DOS date (UTC)
     */
    private static function dosTime(int $timestamp): array
    {
        $timestamp = max($timestamp, 315532800);
        $d = [
            'year' => (int) gmdate('Y', $timestamp),
            'mon' => (int) gmdate('n', $timestamp),
            'mday' => (int) gmdate('j', $timestamp),
            'hours' => (int) gmdate('G', $timestamp),
            'minutes' => (int) gmdate('i', $timestamp),
            'seconds' => (int) gmdate('s', $timestamp),
        ];

        return [
            ($d['hours'] << 11) | ($d['minutes'] << 5) | intdiv($d['seconds'], 2),
            (($d['year'] - 1980) << 9) | ($d['mon'] << 5) | $d['mday'],
        ];
    }
}
