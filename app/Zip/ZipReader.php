<?php

declare(strict_types=1);

namespace JDR\Zip;

defined('JDR_BOOT') || exit;

/**
 * Defensive ZIP reader in pure PHP (no Composer, ext-zip optional).
 *
 * The central directory is always parsed and validated here, whatever the backend:
 * no ZIP64, no multi-disk, no encryption, methods store/deflate only, at most maxEntries entries,
 * declared sizes within limits, compression ratio capped, no symbolic link, no unsafe path
 * (absolute, drive letter, "..", backslash, NUL, empty segment, invalid UTF-8), no duplicate name.
 * Extraction re-checks the real size and the CRC-32 while streaming.
 * Data are decompressed with ZipArchive when the extension is loaded, else with zlib (inflate_*).
 */
final class ZipReader
{
    private const SIG_EOCD = 0x06054b50;
    private const SIG_CENTRAL = 0x02014b50;
    private const SIG_LOCAL = 0x04034b50;
    private const SIG_ZIP64_LOCATOR = "PK\x06\x07";
    private const READ_CHUNK = 8192;

    /** @var resource */
    private $handle;

    /** @var list<ZipEntry> */
    private array $entries = [];

    private int $centralOffset = 0;

    private ?\ZipArchive $archive = null;

    /**
     * @param bool|null $useExtension null = ZipArchive when available
     * @throws ZipException
     */
    public function __construct(private string $path, private ZipLimits $limits = new ZipLimits(), ?bool $useExtension = null)
    {
        $handle = @fopen($path, 'rb');
        if ($handle === false) {
            throw new ZipException('unreadable', 'ZIP file is not readable.');
        }
        $this->handle = $handle;
        try {
            $this->parse();
        } catch (\Throwable $e) {
            fclose($this->handle);
            throw $e;
        }
        $useExtension ??= class_exists(\ZipArchive::class);
        if ($useExtension && class_exists(\ZipArchive::class)) {
            $archive = new \ZipArchive();
            $flags = defined('ZipArchive::RDONLY') ? \ZipArchive::RDONLY : 0;
            if ($archive->open($path, $flags) === true && $archive->numFiles === count($this->entries)) {
                $this->archive = $archive;
            }
        }
    }

    public function __destruct()
    {
        $this->close();
    }

    public function close(): void
    {
        if (is_resource($this->handle)) {
            fclose($this->handle);
        }
        if ($this->archive !== null) {
            @$this->archive->close();
            $this->archive = null;
        }
    }

    public function usesExtension(): bool
    {
        return $this->archive !== null;
    }

    /**
     * @return list<ZipEntry>
     */
    public function entries(): array
    {
        return $this->entries;
    }

    /**
     * Files only (no directory entries).
     *
     * @return list<ZipEntry>
     */
    public function files(): array
    {
        return array_values(array_filter($this->entries, static fn (ZipEntry $e): bool => !$e->isDir));
    }

    public function find(string $name): ?ZipEntry
    {
        foreach ($this->entries as $entry) {
            if ($entry->name === $name) {
                return $entry;
            }
        }

        return null;
    }

    /**
     * Extracts one entry to $destination (created / truncated).
     *
     * @throws ZipException
     */
    public function extractTo(ZipEntry $entry, string $destination, ?int $maxBytes = null): void
    {
        $out = @fopen($destination, 'wb');
        if ($out === false) {
            throw new ZipException('write_failed', 'Cannot write the extracted file.');
        }
        try {
            $this->copy($entry, $maxBytes, static function (string $data) use ($out): void {
                if (fwrite($out, $data) !== strlen($data)) {
                    throw new ZipException('write_failed', 'Cannot write the extracted file.');
                }
            });
        } catch (\Throwable $e) {
            fclose($out);
            @unlink($destination);
            throw $e;
        }
        fclose($out);
    }

    /**
     * @throws ZipException
     */
    public function read(ZipEntry $entry, int $maxBytes): string
    {
        $buffer = '';
        $this->copy($entry, $maxBytes, static function (string $data) use (&$buffer): void {
            $buffer .= $data;
        });

        return $buffer;
    }

    /**
     * Streams the decompressed data of $entry to $write, checking size and CRC-32.
     *
     * @param \Closure(string): void $write
     * @throws ZipException
     */
    private function copy(ZipEntry $entry, ?int $maxBytes, \Closure $write): void
    {
        if ($entry->isDir) {
            throw new ZipException('not_a_file', 'Directory entries cannot be extracted.');
        }
        $limit = min($entry->size, $maxBytes ?? PHP_INT_MAX, $this->limits->maxEntryBytes);
        if ($entry->size > $limit) {
            throw new ZipException('entry_too_large', 'ZIP entry is too large.');
        }
        $crc = hash_init('crc32b');
        $total = 0;
        $emit = static function (string $data) use (&$total, $limit, $crc, $write): void {
            if ($data === '') {
                return;
            }
            $total += strlen($data);
            if ($total > $limit) {
                throw new ZipException('size_mismatch', 'ZIP entry is larger than declared.');
            }
            hash_update($crc, $data);
            $write($data);
        };
        if ($this->archive !== null) {
            $this->copyWithExtension($entry, $emit);
        } else {
            $this->copyWithZlib($entry, $emit);
        }
        if ($total !== $entry->size) {
            throw new ZipException('size_mismatch', 'ZIP entry size does not match the directory.');
        }
        if ((int) hexdec(hash_final($crc)) !== $entry->crc32) {
            throw new ZipException('crc_mismatch', 'ZIP entry CRC-32 does not match.');
        }
    }

    /**
     * @param \Closure(string): void $emit
     */
    private function copyWithExtension(ZipEntry $entry, \Closure $emit): void
    {
        assert($this->archive !== null);
        $stream = method_exists($this->archive, 'getStreamIndex')
            ? $this->archive->getStreamIndex($entry->index)
            : $this->archive->getStream($entry->name);
        if (!is_resource($stream)) {
            throw new ZipException('corrupt', 'ZIP entry cannot be read.');
        }
        try {
            while (!feof($stream)) {
                $chunk = @fread($stream, self::READ_CHUNK);
                if ($chunk === false) {
                    throw new ZipException('corrupt', 'ZIP entry cannot be read.');
                }
                if ($chunk === '') {
                    break;
                }
                $emit($chunk);
            }
        } finally {
            fclose($stream);
        }
    }

    /**
     * @param \Closure(string): void $emit
     */
    private function copyWithZlib(ZipEntry $entry, \Closure $emit): void
    {
        $header = $this->readAt($entry->localHeaderOffset, 30);
        $local = unpack('Vsig/vneeded/vflags/vmethod/vtime/vdate/Vcrc/Vcsize/Vsize/vnlen/vxlen', $header);
        if ($local === false || $local['sig'] !== self::SIG_LOCAL || $local['method'] !== $entry->method) {
            throw new ZipException('corrupt', 'Invalid local file header.');
        }
        $start = $entry->localHeaderOffset + 30 + $local['nlen'] + $local['xlen'];
        if ($start + $entry->compressedSize > $this->centralOffset) {
            throw new ZipException('corrupt', 'ZIP entry overlaps the central directory.');
        }
        $inflate = null;
        if ($entry->method === 8) {
            if (!function_exists('inflate_init')) {
                throw new ZipException('unsupported_method', 'Neither zlib nor ext-zip is available.');
            }
            $inflate = inflate_init(ZLIB_ENCODING_RAW);
            if ($inflate === false) {
                throw new ZipException('corrupt', 'Cannot initialise zlib.');
            }
        }
        fseek($this->handle, $start);
        $left = $entry->compressedSize;
        while ($left > 0) {
            $chunk = fread($this->handle, min(self::READ_CHUNK, $left));
            if ($chunk === false || $chunk === '') {
                throw new ZipException('corrupt', 'Truncated ZIP entry.');
            }
            $left -= strlen($chunk);
            if ($inflate === null) {
                $emit($chunk);
                continue;
            }
            $data = @inflate_add($inflate, $chunk, $left === 0 ? ZLIB_FINISH : ZLIB_SYNC_FLUSH);
            if ($data === false) {
                throw new ZipException('corrupt', 'Invalid deflate data.');
            }
            $emit($data);
        }
    }

    /**
     * @throws ZipException
     */
    private function parse(): void
    {
        $stat = fstat($this->handle);
        $size = is_array($stat) ? (int) $stat['size'] : 0;
        if ($size < 22) {
            throw new ZipException('not_zip', 'File is not a ZIP archive.');
        }
        $tailLength = min($size, 22 + 65535);
        $tail = $this->readAt($size - $tailLength, $tailLength);
        $eocd = null;
        for ($pos = $tailLength - 22; $pos >= 0; $pos--) {
            if (substr($tail, $pos, 4) !== "PK\x05\x06") {
                continue;
            }
            $record = unpack('Vsig/vdisk/vcdDisk/vdiskEntries/ventries/VcdSize/VcdOffset/vcommentLength', substr($tail, $pos, 22));
            if ($record !== false && $pos + 22 + $record['commentLength'] === $tailLength) {
                $eocd = $record;
                if ($pos >= 20 && substr($tail, $pos - 20, 4) === self::SIG_ZIP64_LOCATOR) {
                    throw new ZipException('zip64_unsupported', 'ZIP64 archives are not supported.');
                }
                break;
            }
        }
        if ($eocd === null || $eocd['sig'] !== self::SIG_EOCD) {
            throw new ZipException('not_zip', 'End of central directory not found.');
        }
        if ($eocd['entries'] === 0xFFFF || $eocd['cdSize'] === 0xFFFFFFFF || $eocd['cdOffset'] === 0xFFFFFFFF) {
            throw new ZipException('zip64_unsupported', 'ZIP64 archives are not supported.');
        }
        if ($eocd['disk'] !== 0 || $eocd['cdDisk'] !== 0 || $eocd['diskEntries'] !== $eocd['entries']) {
            throw new ZipException('multi_disk', 'Multi-volume archives are not supported.');
        }
        if ($eocd['entries'] > $this->limits->maxEntries) {
            throw new ZipException('too_many_entries', 'ZIP archive has too many entries.');
        }
        if ($eocd['cdOffset'] + $eocd['cdSize'] > $size) {
            throw new ZipException('corrupt', 'Central directory is out of the file.');
        }
        $this->centralOffset = $eocd['cdOffset'];
        $directory = $this->readAt($eocd['cdOffset'], $eocd['cdSize']);
        $pos = 0;
        $total = 0;
        $names = [];
        for ($i = 0; $i < $eocd['entries']; $i++) {
            if ($pos + 46 > strlen($directory)) {
                throw new ZipException('corrupt', 'Truncated central directory.');
            }
            $r = unpack(
                'Vsig/vmade/vneeded/vflags/vmethod/vtime/vdate/Vcrc/Vcsize/Vsize/vnlen/vxlen/vclen/vdisk/vint/Vext/Voffset',
                substr($directory, $pos, 46),
            );
            if ($r === false || $r['sig'] !== self::SIG_CENTRAL) {
                throw new ZipException('corrupt', 'Invalid central directory record.');
            }
            $name = substr($directory, $pos + 46, $r['nlen']);
            $pos += 46 + $r['nlen'] + $r['xlen'] + $r['clen'];
            if ($pos > strlen($directory)) {
                throw new ZipException('corrupt', 'Truncated central directory.');
            }
            if (($r['flags'] & 0x41) !== 0) {
                throw new ZipException('encrypted', 'Encrypted ZIP entries are not supported.');
            }
            if ($r['method'] !== 0 && $r['method'] !== 8) {
                throw new ZipException('unsupported_method', 'Unsupported compression method.');
            }
            if ($r['csize'] === 0xFFFFFFFF || $r['size'] === 0xFFFFFFFF || $r['offset'] === 0xFFFFFFFF) {
                throw new ZipException('zip64_unsupported', 'ZIP64 archives are not supported.');
            }
            if (($r['made'] >> 8) === 3 && (($r['ext'] >> 16) & 0xF000) === 0xA000) {
                throw new ZipException('symlink', 'Symbolic links are not allowed.');
            }
            self::checkName($name);
            if (isset($names[$name])) {
                throw new ZipException('duplicate_entry', 'Duplicate ZIP entry name.');
            }
            $names[$name] = true;
            $isDir = str_ends_with($name, '/');
            if ($isDir && $r['size'] !== 0) {
                throw new ZipException('corrupt', 'Directory entry with data.');
            }
            if ($r['size'] > $this->limits->maxEntryBytes) {
                throw new ZipException('entry_too_large', 'ZIP entry is too large.');
            }
            $total += $r['size'];
            if ($total > $this->limits->maxTotalBytes) {
                throw new ZipException('too_large', 'ZIP archive is too large once decompressed.');
            }
            if ($r['method'] === 0 && $r['size'] !== $r['csize']) {
                throw new ZipException('corrupt', 'Stored entry with different sizes.');
            }
            if ($r['size'] > $this->limits->ratioThreshold && $r['size'] > $r['csize'] * $this->limits->maxRatio) {
                throw new ZipException('compression_ratio', 'Suspicious compression ratio (zip bomb).');
            }
            if ($r['offset'] + 30 + $r['csize'] > $this->centralOffset) {
                throw new ZipException('corrupt', 'ZIP entry overlaps the central directory.');
            }
            $this->entries[] = new ZipEntry($i, $name, $r['method'], $r['crc'], $r['csize'], $r['size'], $r['offset'], $isDir);
        }
    }

    /**
     * Rejects names that could escape the extraction directory (zip slip) or confuse a file system.
     *
     * @throws ZipException
     */
    public static function checkName(string $name): void
    {
        $unsafe = $name === ''
            || strlen($name) > 255
            || preg_match('//u', $name) !== 1
            || preg_match('/[\x00-\x1F\x7F\\\\:]/', $name) === 1
            || str_starts_with($name, '/');
        if (!$unsafe) {
            $segments = explode('/', str_ends_with($name, '/') ? substr($name, 0, -1) : $name);
            foreach ($segments as $segment) {
                if ($segment === '' || $segment === '.' || $segment === '..') {
                    $unsafe = true;
                    break;
                }
            }
        }
        if ($unsafe) {
            throw new ZipException('unsafe_path', 'Unsafe path in ZIP archive.');
        }
    }

    private function readAt(int $offset, int $length): string
    {
        if ($length === 0) {
            return '';
        }
        fseek($this->handle, $offset);
        $data = '';
        while (strlen($data) < $length) {
            $chunk = fread($this->handle, $length - strlen($data));
            if ($chunk === false || $chunk === '') {
                throw new ZipException('corrupt', 'Unexpected end of ZIP file.');
            }
            $data .= $chunk;
        }

        return $data;
    }
}
