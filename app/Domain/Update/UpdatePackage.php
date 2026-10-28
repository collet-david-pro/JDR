<?php

declare(strict_types=1);

namespace JDR\Domain\Update;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Db;
use JDR\Migrate\MigrationFile;

/**
 * The update package waiting to be installed (one at a time): storage/updates/<id>/package.zip + package.json.
 *
 * package.json: {id, version, current, sha256, size, prefix, files: {path: sha256}, uploaded_at, uploaded_by, summary}.
 * Summary (API / update.php): {id, version, current, authenticity: verified|unverified, sha256, size,
 * files: {added, changed, removed, unchanged}, changes: {added: [], changed: [], removed: []} (≤ 200 paths each),
 * migrations: [file names not applied yet], warnings: [{code, message}], uploaded_at}.
 */
final class UpdatePackage
{
    public const LIST_MAX = 200;

    private string $current;

    public function __construct(
        private UpdateStorage $storage,
        private UpdateChecker $checker,
        private Db $db,
        private Clock $clock,
        ?string $currentVersion = null,
    ) {
        $this->current = $currentVersion ?? \APP_VERSION;
    }

    /**
     * Validates $zipPath (moved into storage on success) and makes it the pending package.
     *
     * @return array<string, mixed> summary
     * @throws UpdateException
     */
    public function accept(string $zipPath, int $userId): array
    {
        if ($this->storage->busyRun() !== null) {
            throw new UpdateException('update.run_in_progress', [], 409);
        }
        $info = (new PackageInspector($this->storage))->inspect($zipPath, $this->current);
        $this->checker->check(false); // refreshes the official hash when the cache is stale (never throws)
        $official = $this->checker->officialHash($info['version']);
        if ($official !== null && !hash_equals($official, $info['sha256'])) {
            throw new UpdateException('update.hash_mismatch', ['expected' => $official, 'actual' => $info['sha256']]);
        }
        $this->discard();
        $id = UpdateStorage::newId();
        $dir = $this->storage->runDir($id);
        if (!mkdir($dir, 0755, true) || !rename($zipPath, $dir . '/package.zip')) {
            UpdateStorage::removeTree($dir);
            throw new \RuntimeException('Cannot store the update package.');
        }
        $package = [
            'id' => $id,
            'version' => $info['version'],
            'current' => $this->current,
            'sha256' => $info['sha256'],
            'size' => $info['size'],
            'prefix' => $info['prefix'],
            'authenticity' => $official !== null ? 'verified' : 'unverified',
            'files' => $info['files'],
            'uploaded_at' => $this->clock->now()->format('Y-m-d\TH:i:s\Z'),
            'uploaded_by' => $userId,
        ];
        $package['summary'] = $this->summary($package);
        $this->storage->writeJson($dir . '/package.json', $package);

        return $package['summary'];
    }

    /**
     * Summary of the pending package (the most recent one), or null.
     *
     * @return array<string, mixed>|null
     */
    public function pending(): ?array
    {
        foreach ($this->storage->ids() as $id) {
            $package = $this->load($id);
            if ($package !== null) {
                return is_array($package['summary'] ?? null) ? $package['summary'] : null;
            }
        }

        return null;
    }

    /**
     * package.json of $id when its archive is still there, else null.
     *
     * @return array<string, mixed>|null
     */
    public function load(string $id): ?array
    {
        if (!UpdateStorage::isId($id)) {
            return null;
        }
        $dir = $this->storage->runDir($id);
        $package = $this->storage->readJson($dir . '/package.json');

        return $package !== null && is_file($dir . '/package.zip') ? $package : null;
    }

    /**
     * Removes every package that is not part of a busy run (and the runs that never started).
     */
    public function discard(): void
    {
        foreach ($this->storage->ids() as $id) {
            $dir = $this->storage->runDir($id);
            $state = $this->storage->readJson($dir . '/state.json');
            if ($state === null || in_array($state['state'] ?? null, ['ready', 'failed', 'restored'], true)) {
                if (is_file($dir . '/package.json')) {
                    UpdateStorage::removeTree($dir);
                }
            }
        }
    }

    /**
     * @param array<string, mixed> $package
     * @return array<string, mixed>
     */
    private function summary(array $package): array
    {
        /** @var array<string, string> $new */
        $new = $package['files'];
        $installed = Manifest::installed($this->storage->root());
        $base = $installed !== null ? $installed->updatable() : Manifest::scanDisk($this->storage->root());
        $changes = ['added' => [], 'changed' => [], 'removed' => []];
        $unchanged = 0;
        foreach ($new as $path => $hash) {
            if (!isset($base[$path])) {
                $changes['added'][] = $path;
            } elseif ($base[$path] !== $hash) {
                $changes['changed'][] = $path;
            } else {
                $unchanged++;
            }
        }
        foreach (array_keys($base) as $path) {
            if (!isset($new[$path])) {
                $changes['removed'][] = $path;
            }
        }
        $warnings = [];
        if ($package['authenticity'] === 'unverified') {
            $warnings[] = ['code' => 'unverified', 'message' => UpdateText::t('warning.unverified')];
        }
        if ($installed === null) {
            $warnings[] = ['code' => 'no_manifest', 'message' => UpdateText::t('warning.no_manifest')];
        }
        if (self::isJump($this->current, (string) $package['version'])) {
            $warnings[] = ['code' => 'version_jump', 'message' => UpdateText::t('warning.version_jump', [
                'from' => $this->current, 'to' => $package['version'],
            ])];
        }

        return [
            'id' => $package['id'],
            'version' => $package['version'],
            'current' => $this->current,
            'authenticity' => $package['authenticity'],
            'sha256' => $package['sha256'],
            'size' => $package['size'],
            'files' => [
                'added' => count($changes['added']),
                'changed' => count($changes['changed']),
                'removed' => count($changes['removed']),
                'unchanged' => $unchanged,
            ],
            'changes' => array_map(static fn (array $list): array => array_slice($list, 0, self::LIST_MAX), $changes),
            'migrations' => $this->newMigrations(array_keys($new)),
            'warnings' => $warnings,
            'uploaded_at' => $package['uploaded_at'],
        ];
    }

    /**
     * More than one minor (or major) version skipped: 0.1.x -> 0.3.0, 1.x -> 3.0.0.
     */
    public static function isJump(string $from, string $to): bool
    {
        $a = Semver::parse($from);
        $b = Semver::parse($to);
        if ($a === null || $b === null) {
            return false;
        }
        $majors = (int) $b['major'] - (int) $a['major'];

        return $majors > 1 || ($majors === 0 && (int) $b['minor'] - (int) $a['minor'] > 1);
    }

    /**
     * Migration files of the package not applied on this database yet.
     *
     * @param list<string> $paths
     * @return list<string>
     */
    private function newMigrations(array $paths): array
    {
        $applied = [];
        try {
            if ($this->db->tableExists('schema_migrations')) {
                foreach ($this->db->fetchAll('SELECT `version` FROM ' . $this->db->t('schema_migrations')
                    . " WHERE `status` = 'applied'") as $row) {
                    $applied[(string) $row['version']] = true;
                }
            }
        } catch (\Throwable) {
            $applied = [];
        }
        $out = [];
        foreach ($paths as $path) {
            if (dirname($path) !== 'migrations') {
                continue;
            }
            $file = MigrationFile::fromPath($path);
            if ($file !== null && !isset($applied[$file->version])) {
                $out[] = basename($path);
            }
        }
        sort($out, SORT_STRING);

        return $out;
    }
}
