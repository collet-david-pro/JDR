<?php

declare(strict_types=1);

namespace JDR\Imaging;

defined('JDR_BOOT') || exit;

/**
 * Thumbnails (projet.md 11.3 step 7): at most 256 px on the longest side (never upscaled),
 * WebP, or PNG when GD cannot write WebP; transparency kept. For animations the first frame is
 * used; when it cannot be decoded, a generic "animation" thumbnail is drawn.
 */
final class Thumbnailer
{
    public const MAX_SIZE = 256;
    public const WEBP_QUALITY = 80;

    /**
     * @return array{path: string, mime: string, size: int}
     * @throws ImageRejected encode_failed
     */
    public function fromImage(\GdImage $source, string $basePath): array
    {
        $width = imagesx($source);
        $height = imagesy($source);
        $scale = min(1.0, self::MAX_SIZE / max($width, $height));
        $thumbWidth = max(1, (int) round($width * $scale));
        $thumbHeight = max(1, (int) round($height * $scale));
        $thumb = imagecreatetruecolor($thumbWidth, $thumbHeight);
        imagealphablending($thumb, false);
        imagesavealpha($thumb, true);
        imagefill($thumb, 0, 0, imagecolorallocatealpha($thumb, 0, 0, 0, 127));
        if (!imageistruecolor($source)) {
            $copy = imagecreatetruecolor($width, $height);
            imagealphablending($copy, false);
            imagesavealpha($copy, true);
            imagefill($copy, 0, 0, imagecolorallocatealpha($copy, 0, 0, 0, 127));
            imagealphablending($copy, true);
            imagecopy($copy, $source, 0, 0, 0, 0, $width, $height);
            imagealphablending($copy, false);
            $source = $copy;
        }
        imagecopyresampled($thumb, $source, 0, 0, 0, 0, $thumbWidth, $thumbHeight, $width, $height);

        return $this->write($thumb, $basePath);
    }

    /**
     * Generic thumbnail used when the first frame of an animation cannot be decoded.
     *
     * @return array{path: string, mime: string, size: int}
     */
    public function generic(string $basePath): array
    {
        $size = self::MAX_SIZE;
        $image = imagecreatetruecolor($size, $size);
        imagefill($image, 0, 0, imagecolorallocate($image, 0xE5, 0xE7, 0xEB));
        $dark = imagecolorallocate($image, 0x6B, 0x72, 0x80);
        imagefilledpolygon($image, [96, 72, 96, 184, 184, 128], $dark);

        return $this->write($image, $basePath);
    }

    /**
     * Decodes a binary image with GD (or Imagick when GD cannot), null on failure.
     */
    public static function decodeString(string $data): ?\GdImage
    {
        $image = Gd::quiet(static fn () => @imagecreatefromstring($data));
        if ($image instanceof \GdImage) {
            return $image;
        }
        if (!Gd::hasImagick()) {
            return null;
        }
        try {
            $imagick = new \Imagick();
            $imagick->readImageBlob($data);
            $imagick->setIteratorIndex(0);
            $imagick->setImageFormat('png');
            $png = $imagick->getImageBlob();
            $imagick->clear();
            $image = Gd::quiet(static fn () => @imagecreatefromstring($png));

            return $image instanceof \GdImage ? $image : null;
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * @return array{path: string, mime: string, size: int}
     */
    private function write(\GdImage $image, string $basePath): array
    {
        $webp = Gd::canWriteWebp();
        $path = $basePath . ($webp ? '.webp' : '.png');
        $ok = Gd::quiet(static fn () => $webp
            ? imagewebp($image, $path, self::WEBP_QUALITY)
            : imagepng($image, $path, Reencoder::PNG_LEVEL));
        clearstatcache(true, $path);
        if (!$ok || !is_file($path)) {
            throw ImageRejected::unsupportedType('encode_failed', 'Cannot write the thumbnail.');
        }

        return ['path' => $path, 'mime' => $webp ? 'image/webp' : 'image/png', 'size' => (int) filesize($path)];
    }
}
