<?php

declare(strict_types=1);

namespace JDR\Domain\Backup;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Core\Errors\NotFoundException;
use JDR\Core\Logger;
use JDR\Core\Session\Session;
use JDR\Core\SystemStatus;
use JDR\Domain\Audit\AuditLog;
use JDR\Domain\Settings\Settings;
use JDR\Domain\Update\Semver;
use JDR\Domain\Update\SqlBackup;
use JDR\Domain\Update\UpdateStorage;

/**
 * Restore of the database from an uploaded dump (format of SqlBackup), driven by the browser in slices.
 * start(): the file is checked before anything changes (gzip, JDR header, dump version <= installed version),
 * then the site goes into maintenance. step(): phase "scan" reads the whole dump and checks every statement
 * against the whitelist (SqlDump) - still nothing changed -, phase "apply" drops the tables of the prefix
 * missing from the dump and replays it (prefix rewritten). The dump holds the settings table (maintenance off):
 * the flag is set again after it and after every slice. At the end: maintenance off unless the schema is behind
 * (update.php applies the migrations), PHP sessions emptied (everybody logs in again), audit entry.
 * A failure during "apply" leaves the site in maintenance; the admin restarts with a file.
 * Steps are authorized by the token returned by start() (the users table is being replaced meanwhile).
 * State: storage/backup-tmp/restore/<id>/state.json.
 */
final class DbRestore
{
    public const STEP_SECONDS = 3.0;
    private const DUMP = 'dump.sql.gz';

    public function __construct(
        private Db $db,
        private Settings $settings,
        private AuditLog $audit,
        private BackupStorage $storage,
        private Logger $logger,
    ) {
    }

    /**
     * Checks the dump and returns the header, or throws backup.invalid_file / 422 backup.too_recent.
     *
     * @return array{version:string, date:string, prefix:string}
     */
    public function inspect(string $file): array
    {
        $first = GzipLines::firstLine($file);
        $header = $first === null ? null : SqlDump::header($first);
        if ($header === null || Semver::parse($header['version']) === null) {
            throw BackupException::invalid('header');
        }
        if ($header['prefix'] === '' && $this->db->prefix() !== '') {
            throw BackupException::invalid('prefix');
        }
        if (Semver::compare($header['version'], \APP_VERSION) > 0) {
            throw new BackupException('backup.too_recent', ['version' => $header['version'], 'current' => \APP_VERSION]);
        }

        return $header;
    }

    /**
     * Takes over $file (moved) and puts the site in maintenance. Returns the state (with its token).
     *
     * @return array<string, mixed>
     */
    public function start(string $file, int $userId, string $username, ?string $ip, int $now): array
    {
        $header = $this->inspect($file);
        if (!$this->lock()) {
            throw new BackupException('backup.busy', [], 409);
        }
        try {
            foreach (scandir($this->storage->restoreDir()) ?: [] as $old) {
                if (UpdateStorage::isId($old)) {
                    UpdateStorage::removeTree($this->storage->restoreDir() . '/' . $old); // a new file replaces any earlier restore
                }
            }
            $id = UpdateStorage::newId();
            $dir = $this->storage->restoreDir() . '/' . $id;
            if (!mkdir($dir, 0755) || (!@rename($file, $dir . '/' . self::DUMP) && !(copy($file, $dir . '/' . self::DUMP) && unlink($file)))) {
                throw new \RuntimeException('Cannot move the uploaded dump.');
            }
            try {
                $previous = $this->settings->bool('maintenance');
            } catch (\Throwable) {
                $previous = false;
            }
            $this->setMaintenance(true);
            $state = [
                'id' => $id,
                'token' => bin2hex(random_bytes(16)),
                'user_id' => $userId,
                'username' => $username,
                'ip' => $ip,
                'status' => 'running',
                'phase' => 'scan',
                'raw' => 0,
                'skip' => 0,
                'size' => (int) filesize($dir . '/' . self::DUMP),
                'line' => 0,
                'statements' => 0,
                'tables' => [],
                'ended' => false,
                'dropped' => false,
                'from' => $header['prefix'],
                'version' => $header['version'],
                'previous_maintenance' => $previous,
                'error' => null,
                'schema_behind' => null,
                'created_at' => $now,
            ];
            BackupStorage::writeJson($dir . '/state.json', $state);

            return $state;
        } finally {
            $this->unlock();
        }
    }

    /**
     * One slice (until $deadline). Unknown id or wrong token => 404.
     *
     * @return array<string, mixed>
     */
    public function step(string $id, string $token, float $deadline, ?Session $session = null): array
    {
        $state = $this->read($id);
        if ($state === null || !hash_equals((string) $state['token'], $token)) {
            throw new NotFoundException();
        }
        if ($state['status'] !== 'running') {
            return $state;
        }
        if (!$this->lock()) {
            throw new BackupException('backup.busy', [], 409);
        }
        try {
            $state = $this->read($id) ?? $state;
            if ($state['status'] !== 'running') {
                return $state;
            }
            $path = $this->storage->restoreDir() . '/' . $id . '/' . self::DUMP;
            try {
                if ($state['phase'] === 'scan') {
                    $state = $this->scan($state, $path, $deadline);
                }
                if ($state['phase'] === 'apply') { // at least one statement per slice
                    $state = $this->apply($state, $path, $deadline);
                    if ($state['phase'] === 'done') {
                        $state = $this->finish($state, $path, $session);
                    } else {
                        $this->setMaintenance(true);
                    }
                }
            } catch (\Throwable $e) {
                $code = $e instanceof BackupException ? $e->errorCode() : 'backup.restore_failed';
                $this->logger->warning('Database restore failed', ['phase' => $state['phase'], 'line' => $state['line'], 'error' => $e->getMessage()]);
                $state['status'] = 'failed';
                $state['error'] = $code;
                $state['error_line'] = $state['line'];
                // Nothing was changed during the scan: the previous maintenance flag comes back.
                $this->setMaintenance($state['phase'] === 'scan' ? (bool) $state['previous_maintenance'] : true);
                @unlink($path);
            }
            BackupStorage::writeJson($this->storage->restoreDir() . '/' . $id . '/state.json', $state);

            return $state;
        } finally {
            $this->unlock();
        }
    }

    /**
     * Most recent restore (for the admin screen), null when none is left.
     *
     * @return array<string, mixed>|null
     */
    public function latest(): ?array
    {
        $best = null;
        foreach (scandir($this->storage->restoreDir()) ?: [] as $id) {
            $state = UpdateStorage::isId($id) ? $this->read($id) : null;
            if ($state !== null && ($best === null || (int) $state['created_at'] > (int) $best['created_at'])) {
                $best = $state;
            }
        }

        return $best;
    }

    /**
     * API form: {id, status: running|done|failed, phase: scan|apply|done, progress: {done, total, percent},
     * version, error, schema_behind} (+ token right after start).
     *
     * @param array<string, mixed> $state
     * @return array<string, mixed>
     */
    public static function toPublic(array $state, bool $withToken = false): array
    {
        $size = max(1, (int) $state['size']);
        $done = $state['phase'] === 'done' ? $size : min($size, (int) $state['raw']);
        // The scan counts for the first 10 %, the replay for the rest.
        $percent = match ($state['phase']) {
            'scan' => (int) floor($done * 10 / $size),
            'apply' => 10 + (int) floor($done * 90 / $size),
            default => 100,
        };
        $out = [
            'id' => $state['id'],
            'status' => $state['status'],
            'phase' => $state['phase'],
            'progress' => ['done' => $done, 'total' => $size, 'percent' => $state['status'] === 'done' ? 100 : min(99, $percent)],
            'version' => $state['version'],
            'error' => $state['error'],
            'schema_behind' => $state['schema_behind'],
        ];
        if ($withToken) {
            $out['token'] = $state['token'];
        }

        return $out;
    }

    /**
     * @param array<string, mixed> $state
     * @return array<string, mixed>
     */
    private function scan(array $state, string $path, float $deadline): array
    {
        $from = (string) $state['from'];
        $to = $this->db->prefix();
        $tables = array_fill_keys($state['tables'], true);
        try {
            $pos = GzipLines::each($path, (int) $state['raw'], (int) $state['skip'], static function (string $line) use (&$state, &$tables, $from, $to): void {
                $state['line']++;
                [$kind, $table] = SqlDump::check($line, $from, $to);
                if ($state['ended'] && $kind !== SqlDump::SKIP) {
                    throw BackupException::invalid('after_end');
                }
                if ($kind === SqlDump::END) {
                    $state['ended'] = true;
                } elseif ($kind === SqlDump::DROP) {
                    $tables[(string) $table] = true;
                }
                if ($kind !== SqlDump::SKIP && $kind !== SqlDump::END) {
                    $state['statements']++;
                }
            }, static fn (): bool => microtime(true) >= $deadline);
        } finally {
            $state['tables'] = array_keys($tables);
        }
        $state['raw'] = $pos['raw'];
        $state['skip'] = $pos['skip'];
        if ($pos['eof']) {
            if (!$state['ended'] || $state['tables'] === []) {
                throw BackupException::invalid('truncated');
            }
            $state = ['phase' => 'apply', 'raw' => 0, 'skip' => 0, 'line' => 0] + $state;
        }

        return $state;
    }

    /**
     * @param array<string, mixed> $state
     * @return array<string, mixed>
     */
    private function apply(array $state, string $path, float $deadline): array
    {
        $pdo = $this->db->pdo();
        $from = (string) $state['from'];
        $to = $this->db->prefix();
        $settingsTable = $to . 'settings';
        $mode = (string) $pdo->query('SELECT @@SESSION.sql_mode')->fetchColumn();
        $zone = (string) $pdo->query('SELECT @@SESSION.time_zone')->fetchColumn();
        $pdo->exec('SET FOREIGN_KEY_CHECKS=0');
        $pdo->exec("SET SQL_MODE='NO_AUTO_VALUE_ON_ZERO'");
        $pdo->exec("SET time_zone='+00:00'");
        try {
            if (!$state['dropped']) {
                foreach (array_diff((new SqlBackup($this->db, $this->storage->dir()))->tables(), $state['tables']) as $extra) {
                    $pdo->exec('DROP TABLE IF EXISTS `' . $extra . '`');
                }
                $state['dropped'] = true;
            }
            $afterDrop = false;
            $pos = GzipLines::each($path, (int) $state['raw'], (int) $state['skip'], function (string $line) use (&$state, &$afterDrop, $pdo, $from, $to, $settingsTable): void {
                $state['line']++;
                [$kind, $table, $sql] = SqlDump::check($line, $from, $to);
                if ($kind === SqlDump::DROP || $kind === SqlDump::CREATE || $kind === SqlDump::INSERT) {
                    $pdo->exec($sql);
                }
                // A slice never ends between a DROP and its CREATE: the table always exists between requests.
                $afterDrop = $kind === SqlDump::DROP;
                if ($kind === SqlDump::INSERT && $table === $settingsTable) {
                    $this->setMaintenance(true);
                }
            }, static function () use (&$afterDrop, $deadline): bool {
                return !$afterDrop && microtime(true) >= $deadline;
            });
        } finally {
            $pdo->exec('SET FOREIGN_KEY_CHECKS=1');
            $pdo->exec('SET SQL_MODE=' . $pdo->quote($mode));
            $pdo->exec('SET time_zone=' . $pdo->quote($zone));
        }
        $state['raw'] = $pos['raw'];
        $state['skip'] = $pos['skip'];
        if ($pos['eof']) {
            $state['phase'] = 'done';
        }

        return $state;
    }

    /**
     * @param array<string, mixed> $state
     * @return array<string, mixed>
     */
    private function finish(array $state, string $path, ?Session $session): array
    {
        $this->settings->refresh();
        try {
            $dbVersion = $this->settings->get('db_version');
        } catch (\Throwable) {
            $dbVersion = null;
        }
        $behind = SystemStatus::isBehind(is_string($dbVersion) ? $dbVersion : null, \REQUIRED_DB_VERSION);
        $this->setMaintenance($behind);
        try {
            $this->db->execute('DELETE FROM ' . $this->db->t('php_sessions'));
        } catch (\Throwable) {
            // No sessions table (fresh instance): nothing to empty.
        }
        $session?->destroy();
        try {
            $exists = $this->db->fetchValue('SELECT 1 FROM ' . $this->db->t('users') . ' WHERE `id` = ?', [(int) $state['user_id']]);
            $this->audit->record($exists === null || $exists === false ? null : (int) $state['user_id'], 'backup.db_restored', 'backup', null, [
                'by' => $state['username'], 'version' => $state['version'], 'prefix' => $state['from'], 'schema_behind' => $behind,
            ], is_string($state['ip']) ? $state['ip'] : null);
        } catch (\Throwable $e) {
            $this->logger->warning('Restore audit entry not written', ['error' => $e->getMessage()]);
        }
        @unlink($path);
        $state['status'] = 'done';
        $state['schema_behind'] = $behind;

        return $state;
    }

    private function setMaintenance(bool $on): void
    {
        try {
            $this->settings->set('maintenance', $on);
        } catch (\Throwable $e) {
            $this->logger->warning('Maintenance flag not written', ['error' => $e->getMessage()]);
        }
    }

    /**
     * @return array<string, mixed>|null
     */
    private function read(string $id): ?array
    {
        if (!UpdateStorage::isId($id)) {
            return null;
        }
        $state = BackupStorage::readJson($this->storage->restoreDir() . '/' . $id . '/state.json');

        return is_array($state) && isset($state['token'], $state['status'], $state['phase']) ? $state : null;
    }

    private function lockName(): string
    {
        return substr('jdr_restore:' . $this->db->prefix(), 0, 64);
    }

    private function lock(): bool
    {
        return (int) $this->db->fetchValue('SELECT GET_LOCK(?, 0)', [$this->lockName()]) === 1;
    }

    private function unlock(): void
    {
        try {
            $this->db->fetchValue('SELECT RELEASE_LOCK(?)', [$this->lockName()]);
        } catch (\Throwable) {
            // Connection lost: the lock went with it.
        }
    }
}
