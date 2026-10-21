<?php

declare(strict_types=1);

namespace JDR\Imaging;

defined('JDR_BOOT') || exit;

/**
 * Import limits of the image pipeline (settings max_upload_bytes, max_dimension_px,
 * max_total_pixels, max_frames, max_animation_ms; defaults = projet.md 7.4 / Q6).
 */
final class Limits
{
    public const DEFAULT_MAX_BYTES = 10485760;
    public const DEFAULT_MAX_DIMENSION = 4096;
    public const DEFAULT_MAX_TOTAL_PIXELS = 16777216;
    public const DEFAULT_MAX_FRAMES = 300;
    public const DEFAULT_MAX_ANIMATION_MS = 20000;

    public function __construct(
        public readonly int $maxBytes = self::DEFAULT_MAX_BYTES,
        public readonly int $maxDimension = self::DEFAULT_MAX_DIMENSION,
        public readonly int $maxTotalPixels = self::DEFAULT_MAX_TOTAL_PIXELS,
        public readonly int $maxFrames = self::DEFAULT_MAX_FRAMES,
        public readonly int $maxAnimationMs = self::DEFAULT_MAX_ANIMATION_MS,
    ) {
        foreach (get_object_vars($this) as $name => $value) {
            if ($value < 1) {
                throw new \InvalidArgumentException("Image limit {$name} must be a positive integer.");
            }
        }
    }

    /**
     * Builds the limits from settings values (keys of the settings table); a missing or
     * invalid key falls back to its default.
     *
     * @param array<string, mixed> $settings
     */
    public static function fromSettings(array $settings): self
    {
        $int = static function (string $key, int $default) use ($settings): int {
            $value = $settings[$key] ?? null;
            if (is_int($value) && $value > 0) {
                return $value;
            }
            if (is_string($value) && ctype_digit($value) && (int) $value > 0) {
                return (int) $value;
            }
            if (is_float($value) && $value >= 1 && $value <= PHP_INT_MAX) {
                return (int) $value;
            }

            return $default;
        };

        return new self(
            $int('max_upload_bytes', self::DEFAULT_MAX_BYTES),
            $int('max_dimension_px', self::DEFAULT_MAX_DIMENSION),
            $int('max_total_pixels', self::DEFAULT_MAX_TOTAL_PIXELS),
            $int('max_frames', self::DEFAULT_MAX_FRAMES),
            $int('max_animation_ms', self::DEFAULT_MAX_ANIMATION_MS),
        );
    }
}
