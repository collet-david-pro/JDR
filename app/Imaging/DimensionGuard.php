<?php

declare(strict_types=1);

namespace JDR\Imaging;

defined('JDR_BOOT') || exit;

/**
 * Dimensions read from the header only, without decoding (projet.md 11.3 step 4), and the
 * anti decompression-bomb / memory checks done before any decoding.
 */
final class DimensionGuard
{
    /** Fixed overhead of the memory check: w x h x 5 + 8 MB must fit in the available memory. */
    public const MEMORY_OVERHEAD = 8 * 1024 * 1024;
    public const BYTES_PER_PIXEL = 5;

    private const IMAGETYPE = [
        Sniffer::PNG => IMAGETYPE_PNG,
        Sniffer::JPEG => IMAGETYPE_JPEG,
        Sniffer::GIF => IMAGETYPE_GIF,
        Sniffer::WEBP => IMAGETYPE_WEBP,
    ];

    /**
     * @param int|null $availableMemory bytes still available to PHP; null = computed from
     *                                  memory_limit (tests inject a value)
     */
    public function __construct(private ?int $availableMemory = null)
    {
    }

    /**
     * @return array{0: int, 1: int} width, height
     * @throws ImageRejected
     */
    public function check(string $path, string $type, Limits $limits): array
    {
        $info = Gd::quiet(static fn () => @getimagesize($path));
        if (!is_array($info) || ($info[2] ?? null) !== self::IMAGETYPE[$type]) {
            throw ImageRejected::unsupportedType('header_unreadable', 'Image header cannot be read.');
        }
        $width = (int) $info[0];
        $height = (int) $info[1];
        $this->checkSize($width, $height, $limits);

        return [$width, $height];
    }

    /**
     * @throws ImageRejected
     */
    public function checkSize(int $width, int $height, Limits $limits): void
    {
        if ($width < 1 || $height < 1) {
            throw ImageRejected::unsupportedType('header_unreadable', 'Image has no dimension.');
        }
        if ($width > $limits->maxDimension || $height > $limits->maxDimension) {
            throw ImageRejected::imageTooLarge(
                'dimension_exceeded',
                sprintf('%dx%d exceeds %d px.', $width, $height, $limits->maxDimension),
            );
        }
        if ($width * $height > $limits->maxTotalPixels) {
            throw ImageRejected::imageTooLarge(
                'pixel_count_exceeded',
                sprintf('%dx%d exceeds %d pixels.', $width, $height, $limits->maxTotalPixels),
            );
        }
        $needed = $width * $height * self::BYTES_PER_PIXEL + self::MEMORY_OVERHEAD;
        $available = $this->availableMemory();
        if ($available !== null && $needed >= $available) {
            throw ImageRejected::imageTooLarge(
                'memory_exceeded',
                sprintf('Decoding needs about %d bytes, %d available.', $needed, $available),
            );
        }
    }

    /** Bytes still available under memory_limit; null when unlimited. */
    public function availableMemory(): ?int
    {
        if ($this->availableMemory !== null) {
            return $this->availableMemory;
        }
        $limit = self::parseIniBytes((string) ini_get('memory_limit'));

        return $limit === null ? null : $limit - memory_get_usage();
    }

    /** "128M", "1G", "524288", "-1" (unlimited => null). */
    public static function parseIniBytes(string $value): ?int
    {
        $value = trim($value);
        if ($value === '' || $value === '-1') {
            return null;
        }
        $unit = strtolower(substr($value, -1));
        $number = (int) $value;
        $factor = match ($unit) {
            'g' => 1024 * 1024 * 1024,
            'm' => 1024 * 1024,
            'k' => 1024,
            default => 1,
        };

        return $number <= 0 ? null : $number * $factor;
    }
}
