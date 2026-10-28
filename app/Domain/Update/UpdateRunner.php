<?php

declare(strict_types=1);

namespace JDR\Domain\Update;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Db;
use JDR\Core\SystemStatus;
use JDR\Domain\Audit\AuditLog;
use JDR\Domain\Settings\Settings;
use JDR\Migrate\MigrationLockedException;
use JDR\Migrate\Runner;
use JDR\Zip\ZipReader;

/**
 * Applies an update as a state machine persisted in storage/updates/<id>/state.json (see RunState),
 * a few seconds of work per request (resumable after any interruption), under a file lock.
 *
 * Package mode: verify, maintenance_on, backup_db, backup_files, copy, verify_files, migrate, finish.
 * Disk mode (files already sent by FTP): verify_files, maintenance_on, backup_db, migrate, finish.
 * Failure up to verify_files => automatic rollback of the files, maintenance flag restored, state "failed".
 * Failed migration => "failed_migration" (maintenance kept): retry() or restore() (database from the SQL
 * backup, then files from rollback/, then maintenance flag restored, state "restored").
 */
final class UpdateRunner
{
    private string $current;

    /**
     * @param \Closure(string): void|null $beforeWrite test hook (see UpdateFiles)
     */
    public function __construct(
        private UpdateStorage $storage,
        private UpdatePackage $packages,
        private Settings $settings,
        private Db $db,
        private Clock $clock,
        private AuditLog $audit,
        ?string $currentVersion = null,
        private ?\Closure $beforeWrite = null,
    ) {
        $this->current = $currentVersion ?? \APP_VERSION;
    }

    /**
     * Loads every class of the updater now: the copy replaces their files, and a class loaded later in the
     * same request must not come from the new version.
     */
    public static function preload(): void
    {
        foreach (glob(__DIR__ . '/*.php') ?: [] as $file) {
            $class = __NAMESPACE__ . '\\' . basename($file, '.php');
            if (preg_match('/^[A-Z]\w+$/', basename($file, '.php')) === 1) {
                class_exists($class) || interface_exists($class);
            }
        }
        UpdateText::has('page.title'); // loads strings.fr.php
        class_exists(Runner::class);
        class_exists(ZipReader::class);
        class_exists(SystemStatus::class);
        class_exists(MigrationLockedException::class);
    }

    /**
     * @return array<string, mixed>|null
     */
    public function state(string $id): ?array
    {
        return UpdateStorage::isId($id) ? $this->storage->readJson($this->storage->runDir($id) . '/state.json') : null;
    }

    /**
     * Turns the pending package $id into a run ready to start.
     *
     * @return array<string, mixed>
     */
    public function prepare(string $id, int $userId, bool $confirmUnverified): array
    {
        $package = $this->packages->load($id) ?? throw new UpdateException('update.no_package', [], 404);
        $busy = $this->storage->busyRun();
        if ($busy !== null && ($busy['id'] ?? null) !== $id) {
            throw new UpdateException('update.run_in_progress', [], 409);
        }
        $existing = $this->state($id);
        if ($existing !== null && !in_array($existing['state'], ['ready', 'failed', 'restored'], true)) {
            return $existing; // already running: idempotent
        }
        if (($package['authenticity'] ?? '') !== 'verified' && !$confirmUnverified) {
            throw new UpdateException('update.unverified');
        }
        if ((string) $package['current'] !== $this->current) {
            throw new UpdateException('update.version_changed', ['current' => $this->current]);
        }
        $installed = Manifest::installed($this->storage->root());
        $base = $installed !== null ? $installed->updatable() : Manifest::scanDisk($this->storage->root());
        $files = new UpdateFiles($this->storage->root(), $this->storage->runDir($id) . '/rollback');
        UpdateStorage::removeTree($this->storage->runDir($id) . '/rollback');
        $s = RunState::create($id, 'package', $this->current, (string) $package['version'], $userId, $this->now(), [
            'package_sha256' => (string) $package['sha256'],
            'prefix' => (string) $package['prefix'],
            'plan' => $files->plan((array) $package['files'], $base),
        ]);
        RunState::log($s, $this->now(), UpdateText::t('log.prepared', ['from' => $this->current, 'to' => $s['to']]));
        $this->save($s);
        $this->audit->record($userId, 'update.started', 'update', null, ['from' => $s['from'], 'to' => $s['to'], 'mode' => 'package']);

        return $s;
    }

    /**
     * What the disk-mode run would do: null when nothing is needed.
     *
     * @return array{from:?string,to:string,db_behind:bool}|null
     */
    public function diskStatus(string $requiredDbVersion): ?array
    {
        $installed = Manifest::installed($this->storage->root());
        $to = $installed?->version ?? $this->current;
        $from = $this->settings->get('app_version');
        $from = is_string($from) && Semver::isValid($from) ? $from : null;
        $dbVersion = $this->settings->get('db_version');
        $behind = SystemStatus::isBehind(is_string($dbVersion) ? $dbVersion : null, $requiredDbVersion);
        if (!$behind && ($from === null || !Semver::greaterThan($to, $from))) {
            return null;
        }

        return ['from' => $from, 'to' => $to, 'db_behind' => $behind];
    }

    /**
     * @return array<string, mixed>
     */
    public function prepareDisk(int $userId, string $requiredDbVersion): array
    {
        $busy = $this->storage->busyRun();
        if ($busy !== null) {
            return $busy;
        }
        $status = $this->diskStatus($requiredDbVersion) ?? throw new UpdateException('update.nothing_to_do', [], 409);
        $id = UpdateStorage::newId();
        mkdir($this->storage->runDir($id), 0755, true);
        $s = RunState::create($id, 'disk', $status['from'], $status['to'], $userId, $this->now());
        RunState::log($s, $this->now(), UpdateText::t('log.prepared_disk', ['to' => $s['to']]));
        $this->save($s);
        $this->audit->record($userId, 'update.started', 'update', null, ['from' => $s['from'], 'to' => $s['to'], 'mode' => 'disk']);

        return $s;
    }

    /**
     * Runs work for about $budget seconds. Returns the state, with busy = true when another request holds the lock.
     *
     * @return array<string, mixed>
     */
    public function step(string $id, float $budget = 5.0): array
    {
        self::preload();
        $s = $this->state($id) ?? throw new UpdateException('update.no_run', [], 404);
        if (in_array($s['state'], RunState::TERMINAL, true) || $s['state'] === 'failed_migration') {
            return $s;
        }
        $lock = $this->lock($id);
        if ($lock === null) {
            return $s + ['busy' => true];
        }
        try {
            $s = $this->state($id) ?? $s;
            $deadline = microtime(true) + $budget;
            if ($s['state'] === 'ready') {
                $s['state'] = 'running';
                RunState::log($s, $this->now(), UpdateText::t('log.started'));
            }
            $steps = new RunSteps($this, $this->storage, $this->settings, $this->db, $this->beforeWrite);
            do {
                $before = [$s['state'], $s['step']];
                $boundary = $steps->run($s, $deadline);
                $this->save($s);
            } while (!$boundary && microtime(true) < $deadline && in_array($s['state'], ['running', 'rolling_back', 'restoring'], true)
                && [$s['state'], $s['step']] !== $before);
            // Same step and time left: the step itself consumed its slice; otherwise the loop advanced.
        } finally {
            $this->unlock($lock);
        }

        return $s;
    }

    /**
     * After a failed migration: run it again.
     *
     * @return array<string, mixed>
     */
    public function retry(string $id): array
    {
        $s = $this->state($id) ?? throw new UpdateException('update.no_run', [], 404);
        if ($s['state'] !== 'failed_migration') {
            throw new UpdateException('update.bad_state', ['state' => $s['state']], 409);
        }
        $s['state'] = 'running';
        $s['step'] = 'migrate';
        $s['error'] = null;
        RunState::log($s, $this->now(), UpdateText::t('log.retry'));
        $this->save($s);

        return $s;
    }

    /**
     * After a failed migration: put the database (and, in package mode, the files) back as before the run.
     *
     * @return array<string, mixed>
     */
    public function restore(string $id): array
    {
        $s = $this->state($id) ?? throw new UpdateException('update.no_run', [], 404);
        if ($s['state'] !== 'failed_migration') {
            throw new UpdateException('update.bad_state', ['state' => $s['state']], 409);
        }
        $s['state'] = 'restoring';
        $s['step'] = 'restore_db';
        $s['restore'] = null;
        $s['cursor'] = 0;
        RunState::log($s, $this->now(), UpdateText::t('log.restore'));
        $this->save($s);

        return $s;
    }

    /**
     * @param array<string, mixed> $s
     */
    public function save(array &$s): void
    {
        $s['updated_at'] = $this->now();
        $this->storage->writeJson($this->storage->runDir((string) $s['id']) . '/state.json', $s);
    }

    public function now(): string
    {
        return $this->clock->now()->format('Y-m-d\TH:i:s\Z');
    }

    public function timestamp(): int
    {
        return $this->clock->timestamp();
    }

    public function audit(): AuditLog
    {
        return $this->audit;
    }

    /**
     * @return resource|null
     */
    private function lock(string $id)
    {
        $handle = fopen($this->storage->runDir($id) . '/lock', 'c');
        if ($handle === false) {
            throw new \RuntimeException('Cannot open the update lock.');
        }
        if (!flock($handle, LOCK_EX | LOCK_NB)) {
            fclose($handle);

            return null;
        }

        return $handle;
    }

    /**
     * @param resource $handle
     */
    private function unlock($handle): void
    {
        flock($handle, LOCK_UN);
        fclose($handle);
    }
}
