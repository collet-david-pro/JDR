<?php

declare(strict_types=1);

namespace JDR\Domain\Update;

defined('JDR_BOOT') || exit;

/**
 * manifest.json of a release ({version, generated_at, files: {path: sha256}}), written by dev/release.mjs.
 */
final class Manifest
{
    public const MAX_BYTES = 8388608;

    /**
     * @param array<string, string> $files path => lowercase SHA-256
     */
    public function __construct(public readonly string $version, public readonly array $files)
    {
    }

    /**
     * Null when the JSON is not a valid manifest (version not semver, bad paths or hashes).
     */
    public static function fromJson(string $json): ?self
    {
        $data = json_decode($json, true, 16);
        if (!is_array($data) || !is_string($data['version'] ?? null) || !is_array($data['files'] ?? null)) {
            return null;
        }
        $version = Semver::normalize($data['version']);
        if ($version === null) {
            return null;
        }
        $files = [];
        foreach ($data['files'] as $path => $hash) {
            $path = (string) $path;
            if (!is_string($hash) || preg_match('/^[0-9a-fA-F]{64}$/', $hash) !== 1 || !PackageRules::isSafe($path)) {
                return null;
            }
            $files[$path] = strtolower($hash);
        }
        ksort($files, SORT_STRING);

        return new self($version, $files);
    }

    /**
     * manifest.json of the installation, or null when missing or invalid.
     */
    public static function installed(string $root): ?self
    {
        $path = $root . '/' . PackageRules::MANIFEST;
        if (!is_file($path) || (int) filesize($path) > self::MAX_BYTES) {
            return null;
        }
        $json = file_get_contents($path);

        return $json === false ? null : self::fromJson($json);
    }

    /**
     * Files the update deals with: allowed paths only (install.php, storage/... are left out).
     *
     * @return array<string, string>
     */
    public function updatable(): array
    {
        return array_filter($this->files, static fn (string $p): bool => PackageRules::isAllowed($p), ARRAY_FILTER_USE_KEY);
    }

    /**
     * Shipped files currently on disk (root files + shipped directories, hidden files skipped except .htaccess),
     * hashed: the reference when the installation has no manifest.json.
     *
     * @return array<string, string>
     */
    public static function scanDisk(string $root): array
    {
        $out = [];
        foreach (PackageRules::ROOT_FILES as $file) {
            if ($file !== PackageRules::MANIFEST && is_file($root . '/' . $file)) {
                $out[$file] = (string) hash_file('sha256', $root . '/' . $file);
            }
        }
        foreach (PackageRules::ROOT_DIRS as $dir) {
            if (!is_dir($root . '/' . $dir)) {
                continue;
            }
            $items = new \RecursiveIteratorIterator(
                new \RecursiveDirectoryIterator($root . '/' . $dir, \FilesystemIterator::SKIP_DOTS),
            );
            foreach ($items as $item) {
                /** @var \SplFileInfo $item */
                $name = $item->getFilename();
                if (!$item->isFile() || $item->isLink() || ($name[0] === '.' && $name !== '.htaccess')) {
                    continue;
                }
                $rel = substr(str_replace('\\', '/', $item->getPathname()), strlen($root) + 1);
                if (PackageRules::isAllowed($rel)) {
                    $out[$rel] = (string) hash_file('sha256', $item->getPathname());
                }
            }
        }
        ksort($out, SORT_STRING);

        return $out;
    }
}
