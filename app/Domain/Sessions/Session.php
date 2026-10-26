<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions;

defined('JDR_BOOT') || exit;

/**
 * A play session (row of play_sessions, projet.md 7.2 / 11.5).
 */
final class Session
{
    public const LOBBY = 'lobby';
    public const RUNNING = 'running';
    public const PAUSED = 'paused';
    public const ENDED = 'ended';
    public const STATES = [self::LOBBY, self::RUNNING, self::PAUSED, self::ENDED];

    /**
     * @param array<string, mixed>|null $camera
     * @param array<string, mixed>|null $pauseScreen {asset_id, text}
     */
    public function __construct(
        public readonly int $id,
        public readonly int $gameId,
        public readonly string $code,
        public readonly ?string $name,
        public readonly string $state,
        public readonly ?int $currentMapId,
        public readonly ?int $currentFloorId,
        public readonly ?array $camera,
        public readonly ?array $pauseScreen,
        public readonly ?int $createdBy,
        public readonly string $createdAt,
        public readonly ?string $startedAt,
        public readonly ?string $endedAt,
    ) {
    }

    /**
     * @param array<string, mixed> $row
     */
    public static function fromRow(array $row): self
    {
        $camera = $row['camera'] === null ? null : json_decode((string) $row['camera'], true);
        $pause = $row['pause_screen'] === null ? null : json_decode((string) $row['pause_screen'], true);

        return new self(
            (int) $row['id'],
            (int) $row['game_id'],
            (string) $row['code'],
            $row['name'] === null ? null : (string) $row['name'],
            (string) $row['state'],
            $row['current_map_id'] === null ? null : (int) $row['current_map_id'],
            $row['current_floor_id'] === null ? null : (int) $row['current_floor_id'],
            is_array($camera) ? $camera : null,
            is_array($pause) ? self::pause($pause) : null,
            $row['created_by'] === null ? null : (int) $row['created_by'],
            (string) $row['created_at'],
            $row['started_at'] === null ? null : (string) $row['started_at'],
            $row['ended_at'] === null ? null : (string) $row['ended_at'],
        );
    }

    public function isEnded(): bool
    {
        return $this->state === self::ENDED;
    }

    /**
     * Next state of a transition action, or null when the transition is not allowed
     * (lobby -> running, running -> paused, paused -> running, anything but ended -> ended).
     */
    public function next(string $action): ?string
    {
        return match ($action) {
            'start' => $this->state === self::LOBBY ? self::RUNNING : null,
            'pause' => $this->state === self::RUNNING ? self::PAUSED : null,
            'resume' => $this->state === self::PAUSED ? self::RUNNING : null,
            'end' => $this->state === self::ENDED ? null : self::ENDED,
            default => null,
        };
    }

    /**
     * @param array<string, mixed> $pause
     * @return array{asset_id: int|null, text: string|null}
     */
    public static function pause(array $pause): array
    {
        return [
            'asset_id' => isset($pause['asset_id']) ? (int) $pause['asset_id'] : null,
            'text' => isset($pause['text']) && is_string($pause['text']) ? $pause['text'] : null,
        ];
    }
}
