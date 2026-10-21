<?php

declare(strict_types=1);

namespace JDR\Domain\Assets;

defined('JDR_BOOT') || exit;

use JDR\Domain\Settings\Settings;
use JDR\Imaging\Limits;

/**
 * Effective upload limits: settings capped by the PHP limits (upload_max_filesize,
 * post_max_size minus the multipart overhead).
 */
final class AssetLimits
{
    /** Room left in post_max_size for the multipart envelope and the other fields. */
    public const MULTIPART_MARGIN = 65536;

    /** Hard cap of an asset pack archive. */
    public const MAX_PACK_BYTES = 536870912;

    public const ACCEPTED_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

    /** @var array{upload: string, post: string}|null */
    private ?array $ini;

    /**
     * @param array{upload: string, post: string}|null $ini overrides ini values (tests)
     */
    public function __construct(private Settings $settings, ?array $ini = null)
    {
        $this->ini = $ini;
    }

    /**
     * Largest request body PHP accepts for one file (bytes).
     */
    public function phpUploadBytes(): int
    {
        $upload = self::iniBytes($this->ini['upload'] ?? (string) ini_get('upload_max_filesize'));
        $post = self::iniBytes($this->ini['post'] ?? (string) ini_get('post_max_size'));
        if ($post !== PHP_INT_MAX) {
            $post = max(1, $post - self::MULTIPART_MARGIN);
        }

        return min($upload, $post);
    }

    public function maxUploadBytes(): int
    {
        return max(1, min($this->settings->int('max_upload_bytes'), $this->phpUploadBytes()));
    }

    public function maxPackBytes(): int
    {
        return max(1, min(self::MAX_PACK_BYTES, $this->phpUploadBytes()));
    }

    public function imageLimits(): Limits
    {
        return Limits::fromSettings([
            'max_upload_bytes' => $this->maxUploadBytes(),
            'max_dimension_px' => $this->settings->int('max_dimension_px'),
            'max_total_pixels' => $this->settings->int('max_total_pixels'),
            'max_frames' => $this->settings->int('max_frames'),
            'max_animation_ms' => $this->settings->int('max_animation_ms'),
        ]);
    }

    /**
     * GET /assets/limits
     *
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        $limits = $this->imageLimits();

        return [
            'max_upload_bytes' => $limits->maxBytes,
            'max_dimension_px' => $limits->maxDimension,
            'max_total_pixels' => $limits->maxTotalPixels,
            'max_frames' => $limits->maxFrames,
            'max_animation_ms' => $limits->maxAnimationMs,
            'accepted_mimes' => self::ACCEPTED_MIMES,
        ];
    }

    /**
     * "8M" => 8388608; "0" or "-1" (no limit) => PHP_INT_MAX.
     */
    public static function iniBytes(string $value): int
    {
        $value = trim($value);
        if ($value === '' || !preg_match('/^(-?\d+)\s*([kmg]?)/i', $value, $m)) {
            return PHP_INT_MAX;
        }
        $n = (int) $m[1];
        if ($n <= 0) {
            return PHP_INT_MAX;
        }

        return match (strtolower($m[2])) {
            'k' => $n * 1024,
            'm' => $n * 1048576,
            'g' => $n * 1073741824,
            default => $n,
        };
    }
}
