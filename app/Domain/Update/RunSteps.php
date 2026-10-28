<?php

declare(strict_types=1);

namespace JDR\Domain\Update;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Core\SystemStatus;
use JDR\Domain\Settings\Settings;
use JDR\Migrate\MigrationLockedException;
use JDR\Migrate\Runner;
use JDR\Zip\ZipReader;

/**
 * The steps of UpdateRunner. run() performs one slice of the current step on the state (by reference)
 * and returns true at a boundary: the request must end there (after the copy, the new code takes over;
 * one migration per request; after a rollback of the files).
 */
final class RunSteps
{
    private const FILE_STEPS = ['verify', 'maintenance_on', 'backup_db', 'backup_files', 'copy', 'verify_files'];

    private UpdateFiles $files;
    private RecoverySteps $recovery;

    /**
     * @param \Closure(string): void|null $beforeWrite
     */
    public function __construct(
        private UpdateRunner $runner,
        private UpdateStorage $storage,
        private Settings $settings,
        private Db $db,
        private ?\Closure $beforeWrite = null,
    ) {
    }

    /**
     * @param array<string, mixed> $s
     */
    public function run(array &$s, float $deadline): bool
    {
        $this->files = new UpdateFiles($this->storage->root(), $this->runDir($s) . '/rollback', $this->beforeWrite);
        $this->recovery = new RecoverySteps($this->runner, $this->storage, $this->settings, $this->db, $this->files);
        $step = (string) $s['step'];
        try {
            if ($s['state'] === 'rolling_back') {
                return $this->recovery->rollback($s, $deadline);
            }
            if ($s['state'] === 'restoring') {
                return match ($step) {
                    'restore_db' => $this->recovery->restoreDb($s, $deadline),
                    'restore_files' => $this->recovery->restoreFiles($s, $deadline),
                    default => $this->recovery->restoreFinish($s),
                };
            }

            return match ($step) {
                'verify' => $this->verify($s),
                'maintenance_on' => $this->maintenanceOn($s),
                'backup_db' => $this->backupDb($s, $deadline),
                'backup_files' => $this->backupFiles($s, $deadline),
                'copy' => $this->copy($s, $deadline),
                'verify_files' => $this->verifyFiles($s, $deadline),
                'migrate' => $this->migrate($s),
                'finish' => $this->finish($s),
                default => throw new \RuntimeException('Unknown step ' . $step),
            };
        } catch (\Throwable $e) {
            $message = UpdateText::t('error.step', ['step' => UpdateText::t('step.' . $step), 'message' => $e->getMessage()]);
            if ($s['state'] === 'running' && in_array($step, self::FILE_STEPS, true)) {
                $this->fail($s, $message);

                return $s['state'] !== 'rolling_back'; // the rollback starts in this same request
            } elseif ($s['state'] === 'running' && $step === 'migrate') {
                $s['state'] = 'failed_migration';
                $s['error'] = $message;
                RunState::log($s, $this->runner->now(), $message);
            } else {
                $s['error'] = $message; // finish / rollback / restore: "Continue" tries the same slice again
                RunState::log($s, $this->runner->now(), $message);
            }

            return true;
        }
    }

    /**
     * @param array<string, mixed> $s
     */
    private function verify(array &$s): bool
    {
        $zip = $this->runDir($s) . '/package.zip';
        if (!is_file($zip) || !hash_equals((string) $s['package_sha256'], (string) hash_file('sha256', $zip))) {
            throw new \RuntimeException(UpdateText::t('error.package_changed'));
        }

        return $this->advance($s, 'log.verified');
    }

    /**
     * @param array<string, mixed> $s
     */
    private function maintenanceOn(array &$s): bool
    {
        if ($s['maintenance_was'] === null) {
            $this->settings->refresh();
            $s['maintenance_was'] = $this->settings->bool('maintenance');
            $this->runner->save($s); // remembered before the flag changes (replay-safe)
        }
        $this->settings->set('maintenance', true);

        return $this->advance($s, 'log.maintenance_on');
    }

    /**
     * @param array<string, mixed> $s
     */
    private function backupDb(array &$s, float $deadline): bool
    {
        $sql = new SqlBackup($this->db, $this->storage->backupsDir());
        if (!is_array($s['backup'])) {
            $s['backup'] = $sql->start((string) ($s['from'] ?? $s['to']), $this->runner->timestamp());
            $this->runner->save($s);
        }
        $s['backup'] = $sql->run($s['backup'], $deadline);
        if (!$s['backup']['done']) {
            return false;
        }
        $sql->prune((string) $s['backup']['file']);

        return $this->advance($s, 'log.backup_db', ['file' => $s['backup']['file'], 'rows' => $s['backup']['rows']]);
    }

    /**
     * @param array<string, mixed> $s
     */
    private function backupFiles(array &$s, float $deadline): bool
    {
        $list = array_merge($s['plan']['write'], $s['plan']['remove']);
        $added = $s['added'];
        $s['cursor'] = $this->files->backup($list, (int) $s['cursor'], $deadline, $added);
        $s['added'] = $added;
        if ($s['cursor'] < count($list)) {
            return false;
        }
        $s['cursor'] = 0;

        return $this->advance($s, 'log.backup_files', ['count' => count($list) - count($added)]);
    }

    /**
     * Order: files (updater last), then removals, then manifest.json.
     *
     * @param array<string, mixed> $s
     */
    private function copy(array &$s, float $deadline): bool
    {
        if (!$s['copy_started']) {
            $s['copy_started'] = true;
            $this->runner->save($s); // from now on a failure means rollback
        }
        $writes = array_values(array_diff($s['plan']['write'], [PackageRules::MANIFEST]));
        $removes = $s['plan']['remove'];
        $w = count($writes);
        $r = count($removes);
        $hashes = (array) ($this->storage->readJson($this->runDir($s) . '/package.json')['files'] ?? []);
        $zip = new ZipReader($this->runDir($s) . '/package.zip', PackageInspector::limits());
        try {
            $cursor = (int) $s['cursor'];
            if ($cursor < $w) {
                $cursor = $this->files->copy($zip, (string) $s['prefix'], $writes, $hashes, $cursor, $deadline);
            }
            if ($cursor >= $w && $cursor < $w + $r) {
                $cursor = $w + $this->files->remove($removes, $cursor - $w, $deadline);
            }
            if ($cursor === $w + $r) {
                $cursor = $w + $r + $this->files->copy($zip, (string) $s['prefix'], [PackageRules::MANIFEST], [], 0, $deadline);
            }
        } finally {
            $zip->close();
        }
        $s['cursor'] = $cursor;
        if ($cursor < $w + $r + 1) {
            return false;
        }
        $s['cursor'] = 0;
        $this->advance($s, 'log.copy', ['written' => $w + 1, 'removed' => $r]);

        return true;
    }

    /**
     * @param array<string, mixed> $s
     */
    private function verifyFiles(array &$s, float $deadline): bool
    {
        if ($s['mode'] === 'package') {
            $hashes = (array) ($this->storage->readJson($this->runDir($s) . '/package.json')['files'] ?? []);
            if ((int) $s['cursor'] === 0 && Manifest::installed($this->storage->root())?->version !== $s['to']) {
                throw new \RuntimeException(UpdateText::t('error.manifest_version'));
            }
        } else {
            $installed = Manifest::installed($this->storage->root());
            if ($installed === null) {
                return $this->advance($s, 'log.verify_skipped');
            }
            $hashes = $installed->updatable();
        }
        $bad = $s['bad'];
        $s['cursor'] = $this->files->verify($hashes, (int) $s['cursor'], $deadline, $bad);
        $s['bad'] = $bad;
        if ($s['cursor'] < count($hashes)) {
            return false;
        }
        $s['cursor'] = 0;
        if ($bad !== []) {
            $s['bad'] = [];
            $s['details'] = array_slice($bad, 0, 200);
            $this->fail($s, UpdateText::t('error.verify_files', ['count' => count($bad), 'files' => implode(', ', array_slice($bad, 0, 5))]));

            return true;
        }

        return $this->advance($s, 'log.verify_files', ['count' => count($hashes)]);
    }

    /**
     * One migration per request.
     *
     * @param array<string, mixed> $s
     */
    private function migrate(array &$s): bool
    {
        $runner = new Runner($this->db, $this->storage->root() . '/migrations');
        try {
            $done = $runner->runNext();
        } catch (MigrationLockedException) {
            RunState::log($s, $this->runner->now(), UpdateText::t('log.migration_locked'));

            return true;
        }
        if ($done !== null) {
            $s['migrations'][] = $done['version'];
            RunState::log($s, $this->runner->now(), UpdateText::t('log.migration', ['name' => $done['version'] . '_' . $done['name']]));

            return true;
        }
        if (SystemStatus::isBehind($runner->currentVersion(), \REQUIRED_DB_VERSION)) {
            throw new \RuntimeException(UpdateText::t('error.db_still_behind', ['required' => \REQUIRED_DB_VERSION]));
        }

        return $this->advance($s, 'log.migrations_done', ['count' => count($s['migrations'])]);
    }

    /**
     * @param array<string, mixed> $s
     */
    private function finish(array &$s): bool
    {
        $this->settings->refresh();
        $this->settings->setMany(['maintenance' => (bool) ($s['maintenance_was'] ?? false), 'app_version' => (string) $s['to']]);
        $this->runner->audit()->record((int) $s['user_id'], 'update.applied', 'update', null, [
            'from' => $s['from'], 'to' => $s['to'], 'mode' => $s['mode'], 'migrations' => $s['migrations'],
        ]);
        if ($s['mode'] === 'package') {
            @unlink($this->runDir($s) . '/package.zip');
            UpdateStorage::removeTree($this->runDir($s) . '/rollback');
        }
        RecoverySteps::resetOpcache();
        $s['state'] = 'done';
        $s['error'] = null;
        $s['finished_at'] = $this->runner->now();
        RunState::log($s, $this->runner->now(), UpdateText::t('log.done', ['to' => $s['to']]));

        return true;
    }

    /**
     * Failure before the migrations: rollback of the files when the copy has started, else plain stop.
     *
     * @param array<string, mixed> $s
     */
    private function fail(array &$s, string $message): void
    {
        $s['error'] = $message;
        RunState::log($s, $this->runner->now(), $message);
        if ($s['mode'] === 'package' && $s['copy_started'] === true) {
            $s['state'] = 'rolling_back';
            $s['cursor'] = 0;
            RunState::log($s, $this->runner->now(), UpdateText::t('log.rollback'));

            return;
        }
        $this->recovery->restoreMaintenance($s);
        $s['state'] = 'failed';
        $s['finished_at'] = $this->runner->now();
    }

    /**
     * @param array<string, mixed> $s
     * @param array<string, mixed> $params
     */
    private function advance(array &$s, string $logKey, array $params = []): bool
    {
        RunState::log($s, $this->runner->now(), UpdateText::t($logKey, $params));
        $next = RunState::next((string) $s['mode'], (string) $s['step']);
        if ($next !== null) {
            $s['step'] = $next;
            $s['cursor'] = 0;
        }

        return false;
    }

    /**
     * @param array<string, mixed> $s
     */
    private function runDir(array $s): string
    {
        return $this->storage->runDir((string) $s['id']);
    }
}
