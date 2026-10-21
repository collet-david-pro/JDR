<?php

declare(strict_types=1);

namespace JDR\Imaging;

defined('JDR_BOOT') || exit;

/**
 * Thin helpers around GD (mandatory extension, projet.md 6.3) and optional Imagick.
 *
 * GD and getimagesize() report recoverable problems as PHP warnings (e.g. "libpng warning:
 * iCCP: known incorrect sRGB profile"): they are silenced here and only the return value is
 * trusted, so that a global error handler never turns a benign warning into a 500.
 */
final class Gd
{
    /**
     * Runs $fn with PHP warnings/notices silenced.
     *
     * @template T
     * @param callable(): T $fn
     * @return T
     */
    public static function quiet(callable $fn): mixed
    {
        set_error_handler(static fn (): bool => true);
        try {
            return $fn();
        } finally {
            restore_error_handler();
        }
    }

    public static function canWriteWebp(): bool
    {
        if (!function_exists('imagewebp') || !function_exists('gd_info')) {
            return false;
        }
        $info = gd_info();

        return !empty($info['WebP Support']);
    }

    public static function hasImagick(): bool
    {
        return extension_loaded('imagick') && class_exists('Imagick');
    }

    /**
     * Prepares a true-colour image for an alpha-preserving save (PNG / WebP).
     */
    public static function prepareAlpha(\GdImage $image): \GdImage
    {
        if (!imageistruecolor($image)) {
            self::quiet(static fn () => imagepalettetotruecolor($image));
        }
        imagealphablending($image, false);
        imagesavealpha($image, true);

        return $image;
    }
}
