<?php

declare(strict_types=1);

namespace JDR\Domain\Update;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Domain\Settings\Settings;

/**
 * Recovery steps of an update run: automatic rollback of the files after a failure (state rolling_back),
 * and the "Restore" action after a failed migration (state restoring: database from the SQL backup,
 * files from rollback/, maintenance flag as before the run).
 */
final class RecoverySteps
{
    public function __construct(
        private UpdateRunner $runner,
        private UpdateStorage $storage,
        private Settings $settings,
        private Db $db,
        private UpdateFiles $files,
    ) {
    }

    /**
     * @param array<string, mixed> $s
     */
    public function rollback(array &$s, float $deadline): bool
    {
        $list = array_merge($s['plan']['write'], $s['plan']['remove']);
        $s['cursor'] = $this->files->rollback($list, $s['added'], (int) $s['cursor'], $deadline);
        if ($s['cursor'] < count(array_unique($list))) {
            return false;
        }
        $this->restoreMaintenance($s);
        self::resetOpcache();
        $s['cursor'] = 0;
        $s['state'] = 'failed';
        $s['finished_at'] = $this->runner->now();
        RunState::log($s, $this->runner->now(), UpdateText::t('log.rolled_back'));

        return true;
    }

    /**
     * @param array<string, mixed> $s
     */
    public function restoreDb(array &$s, float $deadline): bool
    {
        if (!is_array($s['backup']) || $s['backup']['done'] !== true) {
            throw new \RuntimeException(UpdateText::t('error.no_backup'));
        }
        $sql = new SqlBackup($this->db, $this->storage->backupsDir());
        $s['restore'] = $sql->restore(is_array($s['restore']) ? $s['restore'] : $sql->restoreStart($s['backup']), $deadline);
        if (!$s['restore']['done']) {
            return false;
        }
        $this->settings->refresh();
        RunState::log($s, $this->runner->now(), UpdateText::t('log.restore_db'));
        $s['step'] = $s['mode'] === 'package' ? 'restore_files' : 'restore_finish';
        $s['cursor'] = 0;

        return false;
    }

    /**
     * @param array<string, mixed> $s
     */
    public function restoreFiles(array &$s, float $deadline): bool
    {
        $list = array_merge($s['plan']['write'], $s['plan']['remove']);
        $s['cursor'] = $this->files->rollback($list, $s['added'], (int) $s['cursor'], $deadline);
        if ($s['cursor'] < count(array_unique($list))) {
            return false;
        }
        $s['cursor'] = 0;
        $s['step'] = 'restore_finish';
        RunState::log($s, $this->runner->now(), UpdateText::t('log.restore_files'));

        return $this->restoreFinish($s);
    }

    /**
     * @param array<string, mixed> $s
     */
    public function restoreFinish(array &$s): bool
    {
        $this->restoreMaintenance($s);
        self::resetOpcache();
        $this->runner->audit()->record((int) $s['user_id'], 'update.restored', 'update', null, ['from' => $s['from'], 'to' => $s['to']]);
        $s['state'] = 'restored';
        $s['error'] = null;
        $s['finished_at'] = $this->runner->now();
        RunState::log($s, $this->runner->now(), UpdateText::t($s['mode'] === 'package' ? 'log.restored' : 'log.restored_disk'));

        return true;
    }

    /**
     * @param array<string, mixed> $s
     */
    public function restoreMaintenance(array $s): void
    {
        if ($s['maintenance_was'] !== null) {
            $this->settings->set('maintenance', (bool) $s['maintenance_was']);
        }
    }
    public static function resetOpcache(): void
    {
        if (function_exists('opcache_reset')) {
            @opcache_reset();
        }
    }
}
