<?php

declare(strict_types=1);

namespace JDR\Domain\Displays;

defined('JDR_BOOT') || exit;

/**
 * A projection screen (row of session_displays, projet.md 7.2): "pending" until a device pairs
 * with its code, then "active". Dates are SQL DATETIME strings (UTC).
 */
final class Display
{
    public const PENDING = 'pending';
    public const ACTIVE = 'active';
    public const MAX_PER_SESSION = 8;
    public const ONLINE_SECONDS = 60;

    /**
     * @param array<string, mixed> $settings complete settings (defaults merged)
     */
    public function __construct(
        public readonly int $id,
        public readonly int $sessionId,
        public readonly string $name,
        public readonly string $state,
        public readonly ?string $pairingExpiresAt,
        public readonly array $settings,
        public readonly ?string $lastIp,
        public readonly ?string $userAgent,
        public readonly ?string $pairedAt,
        public readonly ?string $lastSeenAt,
        public readonly string $createdAt,
    ) {
    }

    /**
     * @param array<string, mixed> $row
     */
    public static function fromRow(array $row): self
    {
        return new self(
            (int) $row['id'],
            (int) $row['session_id'],
            (string) $row['name'],
            (string) $row['state'],
            $row['pairing_expires_at'] === null ? null : (string) $row['pairing_expires_at'],
            DisplaySettings::decode($row['settings'] ?? null),
            $row['last_ip'] === null ? null : (string) $row['last_ip'],
            $row['user_agent'] === null ? null : (string) $row['user_agent'],
            $row['paired_at'] === null ? null : (string) $row['paired_at'],
            $row['last_seen_at'] === null ? null : (string) $row['last_seen_at'],
            (string) $row['created_at'],
        );
    }

    public function isActive(): bool
    {
        return $this->state === self::ACTIVE;
    }
}
