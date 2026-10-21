<?php

declare(strict_types=1);

namespace JDR\Imaging;

defined('JDR_BOOT') || exit;

/**
 * Decodes and re-encodes still images in their own format (projet.md 11.3 step 6), which drops
 * every metadata block and parasitic byte: PNG level 6, JPEG quality 90 with the EXIF
 * orientation applied, WebP quality 90 (lossless sources stay lossless), single-frame GIF
 * through GD. Transparency is preserved (alpha blending off, savealpha, palette images converted
 * to true colour for PNG/WebP).
 *
 * Colour: GD converts CMYK JPEG to RGB; embedded ICC profiles are dropped without conversion
 * (no reliable sRGB conversion without a colour management engine; Imagick is not required).
 * APNG: GD/libpng only reads the default image (IDAT), the animation chunks are dropped.
 * Animated GIF/WebP are never re-encoded (block rewrite only, see GifParser / WebpParser).
 */
final class Reencoder
{
    public const PNG_LEVEL = 6;
    public const JPEG_QUALITY = 90;
    public const WEBP_QUALITY = 90;

    public function __construct(private DimensionGuard $guard)
    {
    }

    /**
     * Writes the re-encoded image to $outPath and returns the decoded (oriented) image, kept by
     * the caller for the thumbnail.
     *
     * @throws ImageRejected
     */
    public function reencode(string $type, string $path, ParsedImage $info, string $outPath): \GdImage
    {
        $image = $this->decode($type, $path);
        if ($type === Sniffer::JPEG && $info->orientation !== 1) {
            $image = $this->orient($image, $info->orientation);
        }
        $ok = Gd::quiet(function () use ($type, $image, $info, $outPath): bool {
            switch ($type) {
                case Sniffer::PNG:
                    Gd::prepareAlpha($image);

                    return imagepng($image, $outPath, self::PNG_LEVEL);
                case Sniffer::JPEG:
                    return imagejpeg($image, $outPath, self::JPEG_QUALITY);
                case Sniffer::WEBP:
                    if (!Gd::canWriteWebp()) {
                        return false;
                    }
                    Gd::prepareAlpha($image);
                    $quality = $info->lossless && defined('IMG_WEBP_LOSSLESS') ? IMG_WEBP_LOSSLESS : self::WEBP_QUALITY;

                    return imagewebp($image, $outPath, $quality);
                default:
                    return imagegif($image, $outPath);
            }
        });
        clearstatcache(true, $outPath);
        if (!$ok || !is_file($outPath) || filesize($outPath) === 0) {
            throw ImageRejected::unsupportedType('encode_failed', "Cannot re-encode the {$type} image.");
        }

        return $image;
    }

    /**
     * @throws ImageRejected
     */
    public function decode(string $type, string $path): \GdImage
    {
        $image = Gd::quiet(static fn () => match ($type) {
            Sniffer::PNG => @imagecreatefrompng($path),
            Sniffer::JPEG => @imagecreatefromjpeg($path),
            Sniffer::WEBP => function_exists('imagecreatefromwebp') ? @imagecreatefromwebp($path) : false,
            Sniffer::GIF => @imagecreatefromgif($path),
            default => false,
        });
        if (!$image instanceof \GdImage) {
            throw ImageRejected::unsupportedType('decode_failed', "Cannot decode the {$type} image.");
        }

        return $image;
    }

    /**
     * Applies an EXIF orientation (2-8). Rotations need a second bitmap: the memory is checked
     * (and memory_limit raised when allowed) before rotating.
     *
     * @throws ImageRejected image_too_large
     */
    public function orient(\GdImage $image, int $orientation): \GdImage
    {
        if (in_array($orientation, [3, 5, 6, 7, 8], true)) {
            $this->reserveCopy(imagesx($image) * imagesy($image) * 4);
        }
        $rotate = static function (\GdImage $source, int $angle): \GdImage {
            $rotated = Gd::quiet(static fn () => imagerotate($source, $angle, 0));
            if (!$rotated instanceof \GdImage) {
                throw ImageRejected::imageTooLarge('memory_exceeded', 'Cannot rotate the image.');
            }

            return $rotated;
        };
        switch ($orientation) {
            case 2:
                imageflip($image, IMG_FLIP_HORIZONTAL);
                break;
            case 3:
                $image = $rotate($image, 180);
                break;
            case 4:
                imageflip($image, IMG_FLIP_VERTICAL);
                break;
            case 5:
                $image = $rotate($image, 270);
                imageflip($image, IMG_FLIP_HORIZONTAL);
                break;
            case 6:
                $image = $rotate($image, 270);
                break;
            case 7:
                $image = $rotate($image, 90);
                imageflip($image, IMG_FLIP_HORIZONTAL);
                break;
            case 8:
                $image = $rotate($image, 90);
                break;
        }

        return $image;
    }

    /** @throws ImageRejected image_too_large */
    private function reserveCopy(int $bytes): void
    {
        $needed = $bytes + DimensionGuard::MEMORY_OVERHEAD;
        $available = $this->guard->availableMemory();
        if ($available === null || $needed < $available) {
            return;
        }
        $limit = DimensionGuard::parseIniBytes((string) ini_get('memory_limit'));
        if ($limit !== null) {
            $target = $limit + ($needed - $available) + DimensionGuard::MEMORY_OVERHEAD;
            if (Gd::quiet(static fn () => @ini_set('memory_limit', (string) $target)) !== false) {
                return;
            }
        }
        throw ImageRejected::imageTooLarge('memory_exceeded', 'Not enough memory to apply the EXIF orientation.');
    }
}
