<?php

declare(strict_types=1);

namespace JDR\Domain\Backup;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Core\Errors\HttpException;
use JDR\Domain\Jobs\Job;
use JDR\Domain\Jobs\JobHandler;
use JDR\Domain\Update\SqlBackup;
use JDR\Domain\Update\UpdateStorage;

/**
 * db_backup: SQL dump of the prefix (SqlBackup, by slices) in storage/backup-tmp/files/<work>/, downloaded once
 * then deleted (BackupStorage::download). Assets are a separate backup (assets_backup).
 * state = {work, started, cursor?} then {work, file}; result = {file_name, size_bytes, tables, rows}.
 */
final class DbBackupJob implements JobHandler
{
    public function __construct(private Db $db, private BackupStorage $storage)
    {
    }

    public function step(Job $job, float $deadline): void
    {
        $work = $job->state['work'] ?? null;
        $started = (int) ($job->state['started'] ?? time());
        $cursor = $job->state['cursor'] ?? null;
        $dir = $this->storage->workDir($work, !is_array($cursor));
        $sql = new SqlBackup($this->db, $dir);
        if (!is_array($cursor)) {
            $cursor = $sql->start(\APP_VERSION, $started);
        } elseif (!is_file($sql->path((string) $cursor['file']))) {
            throw new HttpException(410, 'job_expired');
        }
        $cursor = $sql->run($cursor, $deadline);
        @touch($dir);
        $count = count($cursor['tables']);
        $job->total = $count + 1;
        $job->done = min((int) $cursor['table'], $count) + ($cursor['done'] ? 1 : 0);
        if (!$cursor['done']) {
            $job->state = ['work' => $work, 'started' => $started, 'cursor' => $cursor];

            return;
        }
        $version = preg_replace('/[^0-9A-Za-z.-]/', '_', \APP_VERSION) ?? 'x';
        $job->status = Job::DONE;
        $job->state = ['work' => $work, 'file' => (string) $cursor['file']];
        $job->result = [
            'file_name' => 'jdr-db-' . gmdate('Ymd-His', $started) . '-v' . $version . '.sql.gz',
            'size_bytes' => (int) $cursor['bytes'],
            'tables' => $count,
            'rows' => (int) $cursor['rows'],
        ];
    }

    public function cleanup(Job $job): void
    {
        $work = $job->state['work'] ?? null;
        if (UpdateStorage::isId($work)) {
            UpdateStorage::removeTree($this->storage->workDir($work));
        }
    }
}
