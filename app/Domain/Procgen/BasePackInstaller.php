<?php

declare(strict_types=1);

namespace JDR\Domain\Procgen;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Core\Logger;
use JDR\Domain\Assets\AssetImporter;
use JDR\Domain\Assets\AssetStorage;
use JDR\Domain\Assets\ImportRequest;
use JDR\Domain\Assets\TagService;
use JDR\Domain\Settings\Settings;

/**
 * Sliced, idempotent installation of the base pack into the general asset library (end of install.php,
 * cron / pseudo-cron after a version change, admin repair button, lazy safety net). No migration:
 * the import goes through the regular pipeline (checks, re-encoding, thumbnail).
 * State: setting `base_pack` = {version, assets: {key: asset id}, failed: {key: reason}, pass, done, retry_at}.
 */
final class BasePackInstaller
{
    public const SETTING = 'base_pack';
    private const LOCK = 'jdr_base_pack';

    public function __construct(
        private Db $db,
        private Settings $settings,
        private AssetImporter $importer,
        private AssetStorage $storage,
        private BasePackManifest $manifest,
        private Logger $logger,
    ) {
    }

    public const SLICE = 6;
    private const RETRY_AFTER_S = 3600;

    /**
     * Safety net (first GET /procgen/pack): finishes the installation in this request when the
     * version changed. Entries that failed are not retried here (cron or admin repair do it).
     *
     * @return array<string, int> pack key => asset id (keys that failed to import are absent)
     */
    public function ensureInstalled(): array
    {
        if ($this->state()['version'] === $this->manifest->version()) {
            return $this->state()['assets'];
        }
        for ($i = 0; $i < 100; $i++) {
            $report = $this->installSlice(1000, 25.0, false, 30);
            if ($report['complete'] || $report['busy']) {
                break;
            }
        }

        return $this->state()['assets'];
    }

    /**
     * True when the pack is not installed for the current version, or failures can be retried.
     */
    public function pending(): bool
    {
        $state = $this->state();

        return $state['version'] !== $this->manifest->version()
            || ($state['failed'] !== [] && $state['retry_at'] <= time());
    }

    public function outdated(): bool
    {
        return $this->state()['version'] !== $this->manifest->version();
    }

    /**
     * One time-boxed slice for the pseudo-cron / cron. Null when there is nothing to do.
     *
     * @return ?array<string, mixed>
     */
    public function tick(float $budget): ?array
    {
        if (!$this->pending()) {
            return null;
        }

        return $this->installSlice(self::SLICE, $budget, $this->state()['version'] === $this->manifest->version());
    }

    /**
     * Installs at most $max missing entries (resumable, idempotent, under a lock).
     * $retry forgets the recorded failures first.
     *
     * @return array{installed: int, present: int, failed: list<array{key: string, name: string, reason: string}>, remaining: int, total: int, complete: bool, busy: bool}
     */
    public function installSlice(int $max = self::SLICE, float $budget = 8.0, bool $retry = false, int $lockWait = 0): array
    {
        $version = $this->manifest->version();
        $entries = $this->manifest->entries();
        $lock = substr(self::LOCK . ':' . $this->db->prefix(), 0, 64);
        if ((int) $this->db->fetchValue('SELECT GET_LOCK(?, ?)', [$lock, $lockWait]) !== 1) {
            return ['installed' => 0, 'present' => 0, 'failed' => [], 'remaining' => count($entries), 'total' => count($entries), 'complete' => false, 'busy' => true];
        }
        try {
            $this->settings->refresh();
            $state = $this->state();
            $inPass = $state['version'] !== $version;
            if ($inPass && $state['pass'] !== $version) {
                $state['pass'] = $version;
                $state['done'] = [];
                $retry = true;
            }
            if ($retry) {
                $state['failed'] = [];
            }
            $done = array_flip($state['done']);
            $categories = [];
            $installed = 0;
            $processed = 0;
            $deadline = microtime(true) + $budget;
            foreach ($entries as $entry) {
                $key = $entry['key'];
                if (($inPass ? isset($done[$key]) : isset($state['assets'][$key])) || isset($state['failed'][$key])) {
                    continue;
                }
                if ($processed >= $max || microtime(true) >= $deadline) {
                    break;
                }
                $processed++;
                try {
                    $result = $this->import($entry, $categories);
                    $state['assets'][$key] = $result->asset->id;
                    $done[$key] = true;
                    if (!$result->duplicate) {
                        $installed++;
                    }
                } catch (\Throwable $e) {
                    $state['failed'][$key] = mb_substr($e->getMessage() !== '' ? $e->getMessage() : $e::class, 0, 200);
                    $this->logger->warning('Base pack entry not installed', ['key' => $key, 'error' => $e->getMessage()]);
                }
            }
            $remaining = 0;
            $failed = [];
            foreach ($entries as $entry) {
                $key = $entry['key'];
                if (isset($state['failed'][$key])) {
                    $failed[] = ['key' => $key, 'name' => $entry['name'], 'reason' => $state['failed'][$key]];
                } elseif (!($inPass ? isset($done[$key]) : isset($state['assets'][$key]))) {
                    $remaining++;
                }
            }
            $complete = $remaining === 0;
            if ($complete && $inPass) {
                $state['version'] = $version;
            }
            if ($complete || !$inPass) {
                $state['pass'] = 0;
                $done = [];
            }
            $state['done'] = array_keys($done);
            $state['retry_at'] = $complete && $failed !== [] ? time() + self::RETRY_AFTER_S : 0;
            $this->save($state);
            $total = count($entries);

            return [
                'installed' => $installed,
                'present' => max(0, $total - $remaining - count($failed) - $installed),
                'failed' => $failed,
                'remaining' => $remaining,
                'total' => $total,
                'complete' => $complete,
                'busy' => false,
            ];
        } finally {
            $this->db->fetchValue('SELECT RELEASE_LOCK(?)', [$lock]);
        }
    }

    /**
     * @param array{key: string, file: string, name: string, category: string, kind: string, tags: list<string>, rgba_sha256: string} $entry
     * @param array<string, ?int> $categories
     */
    private function import(array $entry, array &$categories): \JDR\Domain\Assets\ImportResult
    {
        $tmp = $this->storage->newTmpPath('.png');
        try {
            if (!copy($this->manifest->directory() . '/' . $entry['file'], $tmp)) {
                throw new \RuntimeException('Cannot copy ' . $entry['file']);
            }
            if (!array_key_exists($entry['category'], $categories)) {
                $categories[$entry['category']] = $this->generalCategory($entry['category']);
            }
            $tags = [];
            foreach ($entry['tags'] as $tag) {
                $n = TagService::normalize($tag);
                if ($n !== null) {
                    $tags[$n] = $n;
                }
            }

            return $this->importer->import($tmp, new ImportRequest(null, $entry['name'], $entry['kind'], $categories[$entry['category']], array_values($tags), 'system'));
        } finally {
            $this->storage->remove($tmp);
        }
    }

    /**
     * @param array{version: int, assets: array<string, int>, failed: array<string, string>, pass: int, done: list<string>, retry_at: int} $state
     */
    private function save(array $state): void
    {
        $this->settings->set(self::SETTING, $state);
    }

    /**
     * Top-level general category of that name, created (after the existing ones) when missing.
     */
    private function generalCategory(string $name): ?int
    {
        $table = $this->db->t('asset_categories');
        $id = $this->db->fetchValue(
            'SELECT `id` FROM ' . $table . ' WHERE `owner_user_id` IS NULL AND `parent_id` IS NULL AND `name` = ? ORDER BY `id` LIMIT 1',
            [$name],
        );
        if ($id !== null) {
            return (int) $id;
        }
        $order = (int) $this->db->fetchValue('SELECT COALESCE(MAX(`sort_order`), 0) FROM ' . $table . ' WHERE `owner_user_id` IS NULL');
        $this->db->execute(
            'INSERT INTO ' . $table . ' (`owner_user_id`, `parent_id`, `name`, `sort_order`) VALUES (NULL, NULL, ?, ?)',
            [$name, $order + 10],
        );

        return (int) $this->db->lastInsertId();
    }

    /**
     * @return array{version: int, assets: array<string, int>, failed: array<string, string>, pass: int, done: list<string>, retry_at: int}
     */
    private function state(): array
    {
        $raw = $this->settings->get(self::SETTING);
        $raw = is_array($raw) ? $raw : [];
        $assets = [];
        foreach (is_array($raw['assets'] ?? null) ? $raw['assets'] : [] as $key => $id) {
            if (is_int($id)) {
                $assets[(string) $key] = $id;
            }
        }
        $failed = [];
        foreach (is_array($raw['failed'] ?? null) ? $raw['failed'] : [] as $key => $reason) {
            $failed[(string) $key] = is_string($reason) ? $reason : '';
        }
        $done = [];
        foreach (is_array($raw['done'] ?? null) ? $raw['done'] : [] as $key) {
            if (is_string($key)) {
                $done[] = $key;
            }
        }

        return [
            'version' => is_int($raw['version'] ?? null) ? $raw['version'] : 0,
            'assets' => $assets,
            'failed' => $failed,
            'pass' => is_int($raw['pass'] ?? null) ? $raw['pass'] : 0,
            'done' => $done,
            'retry_at' => is_int($raw['retry_at'] ?? null) ? $raw['retry_at'] : 0,
        ];
    }
}
