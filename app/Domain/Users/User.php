<?php

declare(strict_types=1);

namespace JDR\Domain\Users;

defined('JDR_BOOT') || exit;

use JDR\Domain\Support\Dates;

/**
 * Immutable account snapshot (row of users), loaded once per request by the Auth middleware.
 *
 * The current user is exposed to every API route (with or without the "auth" option) as
 * $request->attribute('user'): a User, or null for an anonymous visitor.
 * toPublic() is the only serialization sent to clients (API contract "User"); the password hash
 * is reachable only through passwordHash().
 */
final class User
{
    public const ROLE_USER = 'user';
    public const ROLE_ADMIN = 'admin';
    public const STATUS_ACTIVE = 'active';
    public const STATUS_SUSPENDED = 'suspended';

    public function __construct(
        public readonly int $id,
        public readonly string $email,
        public readonly string $username,
        private string $passwordHash,
        public readonly string $role,
        public readonly string $status,
        public readonly ?int $storageQuotaBytes,
        public readonly int $storageUsedBytes,
        public readonly string $locale,
        public readonly ?string $emailVerifiedAt,
        public readonly ?string $lastLoginAt,
        public readonly string $createdAt,
        public readonly ?string $deletedAt = null,
    ) {
    }

    /**
     * @param array<string, mixed> $row
     */
    public static function fromRow(array $row): self
    {
        return new self(
            (int) $row['id'],
            (string) $row['email'],
            (string) $row['username'],
            (string) $row['password_hash'],
            (string) $row['role'],
            (string) $row['status'],
            $row['storage_quota_bytes'] === null ? null : (int) $row['storage_quota_bytes'],
            (int) $row['storage_used_bytes'],
            (string) $row['locale'],
            $row['email_verified_at'] === null ? null : (string) $row['email_verified_at'],
            $row['last_login_at'] === null ? null : (string) $row['last_login_at'],
            (string) $row['created_at'],
            ($row['deleted_at'] ?? null) === null ? null : (string) $row['deleted_at'],
        );
    }

    public function passwordHash(): string
    {
        return $this->passwordHash;
    }

    public function isAdmin(): bool
    {
        return $this->role === self::ROLE_ADMIN;
    }

    public function isActive(): bool
    {
        return $this->status === self::STATUS_ACTIVE && $this->deletedAt === null;
    }

    /**
     * Changes whenever the password changes: sessions opened with another password are refused.
     */
    public function sessionFingerprint(): string
    {
        return substr(hash('sha256', 'jdr-session|' . $this->passwordHash), 0, 32);
    }

    /**
     * Public representation (API contract P1 "User"); ids become strings in the envelope.
     *
     * @return array<string, mixed>
     */
    public function toPublic(): array
    {
        return [
            'id' => $this->id,
            'email' => $this->email,
            'username' => $this->username,
            'role' => $this->role,
            'status' => $this->status,
            'locale' => $this->locale,
            'storage_quota_bytes' => $this->storageQuotaBytes,
            'storage_used_bytes' => $this->storageUsedBytes,
            'email_verified_at' => Dates::iso($this->emailVerifiedAt),
            'last_login_at' => Dates::iso($this->lastLoginAt),
            'created_at' => Dates::iso($this->createdAt),
        ];
    }
}
