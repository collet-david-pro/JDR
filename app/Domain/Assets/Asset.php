<?php

declare(strict_types=1);

namespace JDR\Domain\Assets;

defined('JDR_BOOT') || exit;

/**
 * Row of the assets table. ownerId null = general library (managed by admins).
 */
final class Asset
{
    public const KINDS = ['tile', 'object', 'token', 'texture', 'background'];
    public const SOURCES = ['upload', 'generated', 'pack', 'system'];
    public const SCOPE_PERSONAL = 'personal';
    public const SCOPE_GENERAL = 'general';

    public function __construct(
        public readonly int $id,
        public readonly string $uuid,
        public readonly ?int $ownerId,
        public readonly ?int $categoryId,
        public readonly string $name,
        public readonly string $kind,
        public readonly string $mime,
        public readonly string $ext,
        public readonly int $width,
        public readonly int $height,
        public readonly bool $isAnimated,
        public readonly int $frameCount,
        public readonly int $durationMs,
        public readonly int $sizeBytes,
        public readonly int $thumbSizeBytes,
        public readonly string $sha256,
        public readonly string $source,
        public readonly string $createdAt,
        public readonly ?string $deletedAt,
    ) {
    }

    /**
     * @param array<string, mixed> $row
     */
    public static function fromRow(array $row): self
    {
        return new self(
            (int) $row['id'],
            (string) $row['uuid'],
            $row['owner_user_id'] === null ? null : (int) $row['owner_user_id'],
            $row['category_id'] === null ? null : (int) $row['category_id'],
            (string) $row['name'],
            (string) $row['kind'],
            (string) $row['mime'],
            (string) $row['ext'],
            (int) $row['width'],
            (int) $row['height'],
            (bool) $row['is_animated'],
            (int) $row['frame_count'],
            (int) $row['duration_ms'],
            (int) $row['size_bytes'],
            (int) $row['thumb_size_bytes'],
            (string) $row['sha256'],
            (string) $row['source'],
            (string) $row['created_at'],
            $row['deleted_at'] === null ? null : (string) $row['deleted_at'],
        );
    }

    public function isGeneral(): bool
    {
        return $this->ownerId === null;
    }

    public function scope(): string
    {
        return $this->ownerId === null ? self::SCOPE_GENERAL : self::SCOPE_PERSONAL;
    }

    /**
     * Bytes counted in the owner's quota (file + thumbnail).
     */
    public function storedBytes(): int
    {
        return $this->sizeBytes + $this->thumbSizeBytes;
    }
}
