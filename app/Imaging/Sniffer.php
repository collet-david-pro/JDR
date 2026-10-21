<?php

declare(strict_types=1);

namespace JDR\Imaging;

defined('JDR_BOOT') || exit;

/**
 * Real type of an uploaded file (projet.md 11.3 step 3): binary signature AND finfo must agree.
 * The client file name, extension and Content-Type are never looked at.
 * Anything else (SVG, BMP, TIFF, HEIC, HTML, PHP, empty file...) is refused.
 */
final class Sniffer
{
    public const PNG = 'png';
    public const JPEG = 'jpeg';
    public const GIF = 'gif';
    public const WEBP = 'webp';

    /** Canonical MIME type of each accepted type. */
    public const MIME = [
        self::PNG => 'image/png',
        self::JPEG => 'image/jpeg',
        self::GIF => 'image/gif',
        self::WEBP => 'image/webp',
    ];

    public const EXT = [
        self::PNG => 'png',
        self::JPEG => 'jpg',
        self::GIF => 'gif',
        self::WEBP => 'webp',
    ];

    /** finfo answers accepted for each type (libmagic versions differ: APNG, legacy aliases). */
    private const FINFO_ALIASES = [
        self::PNG => ['image/png', 'image/apng', 'image/x-png', 'image/vnd.mozilla.apng'],
        self::JPEG => ['image/jpeg', 'image/pjpeg'],
        self::GIF => ['image/gif'],
        self::WEBP => ['image/webp', 'image/x-webp'],
    ];

    /**
     * @return string one of the PNG / JPEG / GIF / WEBP constants
     * @throws ImageRejected unsupported_type
     */
    public function sniff(string $path): string
    {
        $head = Gd::quiet(static fn () => @file_get_contents($path, false, null, 0, 16));
        if (!is_string($head) || $head === '') {
            throw ImageRejected::unsupportedType('empty_file', 'Empty or unreadable file.');
        }
        $type = self::bySignature($head);
        if ($type === null) {
            throw ImageRejected::unsupportedType('unknown_signature', 'Unknown or forbidden binary signature.');
        }
        $mime = self::finfoMime($path);
        if (!in_array($mime, self::FINFO_ALIASES[$type], true)) {
            throw ImageRejected::unsupportedType(
                'mime_mismatch',
                sprintf('Signature says %s but finfo says %s.', $type, $mime),
            );
        }

        return $type;
    }

    public static function bySignature(string $head): ?string
    {
        if (str_starts_with($head, "\x89PNG\r\n\x1A\n")) {
            return self::PNG;
        }
        if (str_starts_with($head, "\xFF\xD8\xFF")) {
            return self::JPEG;
        }
        if (str_starts_with($head, 'GIF87a') || str_starts_with($head, 'GIF89a')) {
            return self::GIF;
        }
        if (strlen($head) >= 12 && str_starts_with($head, 'RIFF') && substr($head, 8, 4) === 'WEBP') {
            return self::WEBP;
        }

        return null;
    }

    private static function finfoMime(string $path): string
    {
        $finfo = new \finfo(FILEINFO_MIME_TYPE);
        $mime = Gd::quiet(static fn () => $finfo->file($path));

        return is_string($mime) ? strtolower($mime) : 'unknown';
    }
}
