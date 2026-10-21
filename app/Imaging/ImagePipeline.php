<?php

declare(strict_types=1);

namespace JDR\Imaging;

defined('JDR_BOOT') || exit;

/**
 * Steps 3 to 8 of the asset import pipeline (projet.md 11.3), without HTTP nor database:
 *
 *  0. size: empty => unsupported_type, > maxBytes => file_too_large;
 *  3. real type: signature AND finfo (Sniffer);
 *  4. dimensions from the header without decoding, pixel count and memory (DimensionGuard);
 *  5. structure: PNG chunks/CRC (APNG => still), JPEG segments, GIF blocks, WebP RIFF; frame
 *     count and duration limits (animation_too_long); script/markup payload scan (TrapScanner);
 *  6. still images re-encoded in their format (Reencoder); animated GIF/WebP rewritten only;
 *  7. thumbnail (Thumbnailer), first frame for animations;
 *  8. SHA-256 of the FINAL file.
 *
 * The input file is never modified nor deleted. Output files are created in $workDir as
 * "{random}.{ext}" and "{random}_thumb.{webp|png}"; on refusal nothing is left behind.
 */
final class ImagePipeline
{
    public function __construct(
        private Sniffer $sniffer = new Sniffer(),
        private DimensionGuard $guard = new DimensionGuard(),
        private TrapScanner $traps = new TrapScanner(),
        private Thumbnailer $thumbnailer = new Thumbnailer(),
        private ?Reencoder $reencoder = null,
    ) {
        $this->reencoder ??= new Reencoder($this->guard);
    }

    /**
     * @throws ImageRejected
     */
    public function process(string $path, Limits $limits, string $workDir): ProcessedImage
    {
        if (!is_dir($workDir) || !is_writable($workDir)) {
            throw new \RuntimeException('Image work directory is not writable.');
        }
        clearstatcache(true, $path);
        $size = is_file($path) ? (int) filesize($path) : 0;
        if ($size === 0) {
            throw ImageRejected::unsupportedType('empty_file', 'Empty or missing file.');
        }
        if ($size > $limits->maxBytes) {
            throw ImageRejected::fileTooLarge(
                'file_too_large',
                sprintf('%d bytes exceeds %d.', $size, $limits->maxBytes),
            );
        }
        $type = $this->sniffer->sniff($path);
        [$width, $height] = $this->guard->check($path, $type, $limits);
        $data = (string) file_get_contents($path);
        $info = $this->parse($type, $data);
        if ($info->width !== $width || $info->height !== $height) {
            throw ImageRejected::unsupportedType('header_mismatch', 'Header and structure disagree on the size.');
        }
        $this->checkAnimation($info, $limits);
        $this->traps->scan($data, $info->opaqueRanges);
        unset($data);

        $base = rtrim($workDir, '/\\') . DIRECTORY_SEPARATOR . bin2hex(random_bytes(12));
        $finalPath = $base . '.' . Sniffer::EXT[$type];
        $created = [$finalPath];
        try {
            if ($info->animated) {
                $result = $this->keepAnimation($type, $info, $finalPath, $base . '_thumb');
            } else {
                $result = $this->reencodeStill($type, $path, $info, $finalPath, $base . '_thumb');
            }
            $created[] = $result['thumb']['path'];
            clearstatcache(true, $finalPath);

            return new ProcessedImage(
                path: $finalPath,
                mime: Sniffer::MIME[$type],
                ext: Sniffer::EXT[$type],
                width: $result['width'],
                height: $result['height'],
                isAnimated: $info->animated && $info->frameCount > 1,
                frameCount: $info->animated ? $info->frameCount : 1,
                durationMs: $info->animated ? $info->durationMs : 0,
                sizeBytes: (int) filesize($finalPath),
                sha256: (string) hash_file('sha256', $finalPath),
                thumbPath: $result['thumb']['path'],
                thumbMime: $result['thumb']['mime'],
                thumbSizeBytes: $result['thumb']['size'],
            );
        } catch (\Throwable $e) {
            foreach ([...$created, $base . '_thumb.webp', $base . '_thumb.png'] as $file) {
                if (is_file($file)) {
                    @unlink($file);
                }
            }
            throw $e;
        }
    }

    private function parse(string $type, string $data): ParsedImage
    {
        return match ($type) {
            Sniffer::PNG => (new PngParser())->parse($data),
            Sniffer::JPEG => (new JpegParser())->parse($data),
            Sniffer::GIF => (new GifParser())->parse($data),
            default => (new WebpParser())->parse($data),
        };
    }

    /** @throws ImageRejected animation_too_long */
    private function checkAnimation(ParsedImage $info, Limits $limits): void
    {
        if (!$info->animated) {
            return;
        }
        if ($info->frameCount > $limits->maxFrames) {
            throw ImageRejected::animationTooLong(
                'too_many_frames',
                sprintf('%d frames exceeds %d.', $info->frameCount, $limits->maxFrames),
            );
        }
        if ($info->durationMs > $limits->maxAnimationMs) {
            throw ImageRejected::animationTooLong(
                'duration_exceeded',
                sprintf('%d ms exceeds %d.', $info->durationMs, $limits->maxAnimationMs),
            );
        }
    }

    /**
     * @return array{width: int, height: int, thumb: array{path: string, mime: string, size: int}}
     */
    private function reencodeStill(string $type, string $path, ParsedImage $info, string $finalPath, string $thumbBase): array
    {
        $image = $this->reencoder->reencode($type, $path, $info, $finalPath);
        $width = imagesx($image);
        $height = imagesy($image);
        $thumb = $this->thumbnailer->fromImage($image, $thumbBase);

        return ['width' => $width, 'height' => $height, 'thumb' => $thumb];
    }

    /**
     * @return array{width: int, height: int, thumb: array{path: string, mime: string, size: int}}
     */
    private function keepAnimation(string $type, ParsedImage $info, string $finalPath, string $thumbBase): array
    {
        $clean = (string) $info->cleanData;
        if (@file_put_contents($finalPath, $clean) !== strlen($clean)) {
            throw new \RuntimeException('Cannot write the image in the work directory.');
        }
        $first = $type === Sniffer::GIF
            ? Thumbnailer::decodeString($clean)
            : $this->webpFirstFrame($info);
        $thumb = $first !== null
            ? $this->thumbnailer->fromImage($first, $thumbBase)
            : $this->thumbnailer->generic($thumbBase);

        return ['width' => $info->width, 'height' => $info->height, 'thumb' => $thumb];
    }

    /** First frame of an animated WebP placed on its canvas, null when it cannot be decoded. */
    private function webpFirstFrame(ParsedImage $info): ?\GdImage
    {
        $frame = $info->firstFrame;
        if ($frame === null) {
            return null;
        }
        $image = Thumbnailer::decodeString($frame['data']);
        if ($image === null) {
            return null;
        }
        if ($frame['x'] === 0 && $frame['y'] === 0
            && imagesx($image) === $frame['canvasWidth'] && imagesy($image) === $frame['canvasHeight']) {
            return $image;
        }
        $canvas = imagecreatetruecolor($frame['canvasWidth'], $frame['canvasHeight']);
        imagealphablending($canvas, false);
        imagesavealpha($canvas, true);
        imagefill($canvas, 0, 0, imagecolorallocatealpha($canvas, 0, 0, 0, 127));
        imagecopy($canvas, $image, $frame['x'], $frame['y'], 0, 0, imagesx($image), imagesy($image));

        return $canvas;
    }
}
