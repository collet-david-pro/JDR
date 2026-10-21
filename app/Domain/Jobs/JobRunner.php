<?php

declare(strict_types=1);

namespace JDR\Domain\Jobs;

defined('JDR_BOOT') || exit;

use JDR\Core\Container;
use JDR\Core\Db;
use JDR\Core\Errors\HttpException;
use JDR\Core\Logger;
use JDR\Domain\Assets\Packs\PackExportJob;
use JDR\Domain\Assets\Packs\PackImportJob;
use JDR\Zip\ZipException;

/**
 * Runs background jobs slice by slice, driven by the browser (POST /jobs/{id}/step).
 * One slice at a time per job (GET_LOCK); resume from progress.state.
 */
final class JobRunner
{
    public const DEFAULT_BUDGET_S = 3.0;

    /** @var array<string, class-string<JobHandler>> */
    public const HANDLERS = [
        'pack_import' => PackImportJob::class,
        'pack_export' => PackExportJob::class,
    ];

    public function __construct(
        private JobRepository $jobs,
        private Container $container,
        private Db $db,
        private Logger $logger,
    ) {
    }

    public function step(Job $job, float $budgetSeconds = self::DEFAULT_BUDGET_S): Job
    {
        if ($job->isFinished()) {
            return $job;
        }
        $lock = $this->lockName($job->id);
        if ((int) $this->db->fetchValue('SELECT GET_LOCK(?, 0)', [$lock]) !== 1) {
            return $this->jobs->find($job->id) ?? $job; // another slice is running
        }
        try {
            $job = $this->jobs->find($job->id) ?? $job;
            if ($job->isFinished()) {
                return $job;
            }
            $handler = $this->handler($job->type);
            $job->status = Job::RUNNING;
            try {
                $handler->step($job, microtime(true) + $budgetSeconds);
            } catch (\Throwable $e) {
                $job->status = Job::FAILED;
                $job->result = ($job->result ?? []) + ['error' => self::errorCode($e)];
                $this->logger->warning('Job failed', ['job' => $job->id, 'type' => $job->type, 'error' => $e->getMessage()]);
                $handler->cleanup($job);
            }
            $this->jobs->save($job);

            return $job;
        } finally {
            $this->db->fetchValue('SELECT RELEASE_LOCK(?)', [$lock]);
        }
    }

    public function cancel(Job $job): Job
    {
        $lock = $this->lockName($job->id);
        $locked = (int) $this->db->fetchValue('SELECT GET_LOCK(?, 10)', [$lock]) === 1;
        try {
            $job = $this->jobs->find($job->id) ?? $job;
            if ($job->isFinished()) {
                return $job;
            }
            $job->status = Job::CANCELLED;
            $this->handler($job->type)->cleanup($job);
            $this->jobs->save($job);

            return $job;
        } finally {
            if ($locked) {
                $this->db->fetchValue('SELECT RELEASE_LOCK(?)', [$lock]);
            }
        }
    }

    private function handler(string $type): JobHandler
    {
        $class = self::HANDLERS[$type] ?? null;
        if ($class === null) {
            throw new \RuntimeException('Unknown job type: ' . $type);
        }
        $handler = $this->container->get($class);
        assert($handler instanceof JobHandler);

        return $handler;
    }

    private function lockName(int $id): string
    {
        return substr('jdr_job:' . $this->db->prefix() . ':' . $id, 0, 64);
    }

    private static function errorCode(\Throwable $e): string
    {
        return match (true) {
            $e instanceof HttpException => $e->errorCode(),
            $e instanceof ZipException => 'invalid_pack',
            default => 'internal_error',
        };
    }
}
