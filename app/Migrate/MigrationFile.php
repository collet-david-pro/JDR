<?php

declare(strict_types=1);

namespace JDR\Migrate;

defined('JDR_BOOT') || exit;

/**
 * A migration file on disk: migrations/NNNN_name.(sql|php).
 */
final class MigrationFile
{
    public const PATTERN = '/^(\d{4})_([a-z0-9_]+)\.(sql|php)$/';

    private ?string $checksum = null;

    private function __construct(
        public readonly string $version,
        public readonly string $name,
        public readonly string $type,
        public readonly string $path
    ) {
    }

    /**
     * Returns null when the file name does not follow the NNNN_name.(sql|php) pattern.
     */
    public static function fromPath(string $path): ?self
    {
        if (preg_match(self::PATTERN, basename($path), $m) !== 1) {
            return null;
        }

        return new self($m[1], $m[2], $m[3], $path);
    }

    /**
     * Discovers migration files in $dir, sorted by version.
     *
     * @return list<self>
     */
    public static function discover(string $dir): array
    {
        if (!is_dir($dir)) {
            throw new MigrationException('Migrations directory not found: ' . $dir);
        }
        $files = [];
        foreach (scandir($dir) ?: [] as $entry) {
            $file = self::fromPath($dir . DIRECTORY_SEPARATOR . $entry);
            if ($file === null || !is_file($file->path)) {
                continue;
            }
            if (isset($files[$file->version])) {
                throw new MigrationException(sprintf(
                    'Duplicate migration version %s (%s and %s).',
                    $file->version,
                    basename($files[$file->version]->path),
                    $entry
                ));
            }
            $files[$file->version] = $file;
        }
        ksort($files, SORT_STRING);

        return array_values($files);
    }

    public function checksum(): string
    {
        return $this->checksum ??= Checksums::ofFile($this->path);
    }

    public function idempotentDdl(): bool
    {
        return $this->type === 'sql'
            && preg_match('/^[ \t]*--[ \t]+@idempotent-ddl\b/m', $this->contents()) === 1;
    }

    public function contents(): string
    {
        $content = @file_get_contents($this->path);
        if ($content === false) {
            throw new MigrationException('Cannot read migration file: ' . basename($this->path));
        }

        return $content;
    }

    /**
     * @return array{version:string,name:string,type:string}
     */
    public function toArray(): array
    {
        return ['version' => $this->version, 'name' => $this->name, 'type' => $this->type];
    }
}
