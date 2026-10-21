<?php

declare(strict_types=1);

namespace JDR\Domain\Jobs;

defined('JDR_BOOT') || exit;

/**
 * Row of background_jobs (projet.md 6.5, 7.2). progress JSON = {done, total, state}: "state" is the
 * private resume cursor of the handler, never sent to clients.
 */
final class Job
{
    public const PENDING = 'pending';
    public const RUNNING = 'running';
    public const DONE = 'done';
    public const FAILED = 'failed';
    public const CANCELLED = 'cancelled';

    /**
     * @param array<string, mixed>      $state
     * @param array<string, mixed>|null $result
     */
    public function __construct(
        public readonly int $id,
        public readonly string $type,
        public string $status,
        public int $done,
        public int $total,
        public array $state,
        public ?array $result,
        public readonly ?int $createdBy,
        public readonly string $createdAt,
    ) {
    }

    /**
     * @param array<string, mixed> $row
     */
    public static function fromRow(array $row): self
    {
        $progress = json_decode((string) $row['progress'], true);
        $progress = is_array($progress) ? $progress : [];
        $result = $row['result'] === null ? null : json_decode((string) $row['result'], true);

        return new self(
            (int) $row['id'],
            (string) $row['type'],
            (string) $row['status'],
            (int) ($progress['done'] ?? 0),
            (int) ($progress['total'] ?? 0),
            is_array($progress['state'] ?? null) ? $progress['state'] : [],
            is_array($result) ? $result : null,
            $row['created_by'] === null ? null : (int) $row['created_by'],
            (string) $row['created_at'],
        );
    }

    public function isFinished(): bool
    {
        return in_array($this->status, [self::DONE, self::FAILED, self::CANCELLED], true);
    }

    /**
     * API representation: {id, type, status, progress: {done, total, percent}, result}.
     *
     * @return array<string, mixed>
     */
    public function toPublic(): array
    {
        $percent = $this->total > 0 ? (int) floor(min($this->done, $this->total) * 100 / $this->total) : ($this->status === self::DONE ? 100 : 0);

        return [
            'id' => $this->id,
            'type' => $this->type,
            'status' => $this->status,
            'progress' => ['done' => $this->done, 'total' => $this->total, 'percent' => $percent],
            'result' => $this->result,
        ];
    }
}
