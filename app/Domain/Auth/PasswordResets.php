<?php

declare(strict_types=1);

namespace JDR\Domain\Auth;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Db;
use JDR\Core\Errors\GoneException;
use JDR\Core\Signer;
use JDR\Domain\Support\Dates;
use JDR\Domain\Support\Links;

/**
 * Single-use password reset links, valid 1 hour (projet.md 6.7).
 * Token = random.expiry.signature (HMAC with app_secret); only SHA-256(random) is stored.
 */
final class PasswordResets
{
    public const LIFETIME = 3600;

    public function __construct(
        private Db $db,
        private Clock $clock,
        private Signer $signer,
        private Links $links,
    ) {
    }

    /**
     * @return array{url: string, expires_at: string, token: string}
     */
    public function create(int $userId, ?int $createdBy): array
    {
        $now = $this->clock->timestamp();
        $expires = $now + self::LIFETIME;
        $random = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $token = $random . '.' . $expires . '.' . $this->signer->signWithExpiry($expires, 'reset', $random);
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('password_resets')
            . ' (`user_id`, `token_hash`, `created_by`, `expires_at`, `used_at`) VALUES (?, ?, ?, ?, NULL)',
            [$userId, hash('sha256', $random), $createdBy, Dates::sql($expires)],
        );

        return [
            'url' => $this->links->passwordReset($token),
            'expires_at' => Dates::isoFromTimestamp($expires),
            'token' => $token,
        ];
    }

    /**
     * Marks the token used and returns its user id. Must run inside a transaction.
     *
     * @throws GoneException reset_link_invalid (unknown, falsified, expired or already used)
     */
    public function consume(string $token): int
    {
        $now = $this->clock->timestamp();
        $parts = explode('.', $token);
        if (count($parts) !== 3 || !ctype_digit($parts[1])
            || !$this->signer->verifyWithExpiry($parts[2], (int) $parts[1], $now, 'reset', $parts[0])) {
            throw self::invalid();
        }
        $row = $this->db->fetchOne(
            'SELECT `id`, `user_id`, `expires_at`, `used_at` FROM ' . $this->db->t('password_resets')
            . ' WHERE `token_hash` = ? FOR UPDATE',
            [hash('sha256', $parts[0])],
        );
        if ($row === null || $row['used_at'] !== null || (Dates::timestamp($row['expires_at']) ?? 0) <= $now) {
            throw self::invalid();
        }
        $this->db->execute(
            'UPDATE ' . $this->db->t('password_resets') . ' SET `used_at` = ? WHERE `id` = ?',
            [Dates::sql($now), (int) $row['id']],
        );

        return (int) $row['user_id'];
    }

    /**
     * Invalidates every pending link of a user (after a password change).
     */
    public function revokeForUser(int $userId): void
    {
        $this->db->execute(
            'DELETE FROM ' . $this->db->t('password_resets') . ' WHERE `user_id` = ? AND `used_at` IS NULL',
            [$userId],
        );
    }

    public function purgeExpired(): int
    {
        return $this->db->execute(
            'DELETE FROM ' . $this->db->t('password_resets') . ' WHERE `expires_at` < ?',
            [$this->clock->sql()],
        );
    }

    private static function invalid(): GoneException
    {
        return new GoneException('', [], 'reset_link_invalid');
    }
}
