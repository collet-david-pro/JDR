<?php

declare(strict_types=1);

namespace JDR\Domain\Jobs;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Db;

final class JobRepository
{
    private const JSON = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR;

    public function __construct(private Db $db, private Clock $clock)
    {
    }

    /**
     * @param array<string, mixed> $state
     */
    public function create(string $type, ?int $createdBy, int $total, array $state): Job
    {
        $now = $this->clock->sql();
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('background_jobs')
            . ' (`type`, `status`, `progress`, `result`, `created_by`, `created_at`, `updated_at`) VALUES (?, ?, ?, NULL, ?, ?, ?)',
            [$type, Job::PENDING, json_encode(['done' => 0, 'total' => $total, 'state' => $state], self::JSON), $createdBy, $now, $now],
        );

        return $this->find((int) $this->db->lastInsertId()) ?? throw new \RuntimeException('Job not created.');
    }

    public function find(int $id): ?Job
    {
        $row = $this->db->fetchOne('SELECT * FROM ' . $this->db->t('background_jobs') . ' WHERE `id` = ?', [$id]);

        return $row === null ? null : Job::fromRow($row);
    }

    public function save(Job $job): void
    {
        $this->db->execute(
            'UPDATE ' . $this->db->t('background_jobs') . ' SET `status` = ?, `progress` = ?, `result` = ?, `updated_at` = ? WHERE `id` = ?',
            [
                $job->status,
                json_encode(['done' => $job->done, 'total' => $job->total, 'state' => $job->state === [] ? new \stdClass() : $job->state], self::JSON),
                $job->result === null ? null : json_encode($job->result, self::JSON),
                $this->clock->sql(),
                $job->id,
            ],
        );
    }
}
