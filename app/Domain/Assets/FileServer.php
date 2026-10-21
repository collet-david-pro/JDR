<?php

declare(strict_types=1);

namespace JDR\Domain\Assets;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\ForbiddenException;
use JDR\Core\Errors\NotFoundException;
use JDR\Core\Request;
use JDR\Core\Response;

/**
 * GET /files/{uuid}?t=full|thumb&e=&s= (projet.md 9.3): public, no session; the signature
 * (checked once when the URL was given) and the expiry are verified, then the file is streamed
 * by the kernel in chunks: exact Content-Type, Content-Length, ETag (sha256), If-None-Match => 304,
 * single Range => 206 / 416, immutable private cache, nosniff, CSP default-src 'none'.
 * TODO(P10): X-Sendfile / X-Accel-Redirect when the diagnostic detects it.
 */
final class FileServer
{
    public function __construct(private AssetRepository $assets, private AssetStorage $storage, private AssetUrls $urls)
    {
    }

    public function serve(Request $request, string $uuid): Response
    {
        $type = $request->query['t'] ?? null;
        if (!AssetStorage::isUuid($uuid) || !$this->urls->verify($uuid, $type, $request->query['e'] ?? null, $request->query['s'] ?? null)) {
            throw new ForbiddenException();
        }
        $asset = $this->assets->findByUuid($uuid);
        if ($asset === null || $asset->deletedAt !== null) {
            throw new NotFoundException();
        }
        if ($type === 'thumb') {
            $thumb = $this->storage->findThumb($uuid);
            if ($thumb === null) {
                throw new NotFoundException();
            }
            $path = $thumb['path'];
            $mime = $thumb['mime'];
            $etag = '"' . $asset->sha256 . '-t"';
            $fileName = self::fileName($asset->name) . '-thumb.' . pathinfo($path, PATHINFO_EXTENSION);
        } else {
            $path = $this->storage->path($uuid, $asset->ext);
            $mime = $asset->mime;
            $etag = '"' . $asset->sha256 . '"';
            $fileName = self::fileName($asset->name) . '.' . $asset->ext;
        }
        $size = is_file($path) ? filesize($path) : false;
        if ($size === false) {
            throw new NotFoundException();
        }
        $headers = [
            'Content-Type' => $mime,
            'ETag' => $etag,
            'Cache-Control' => 'private, max-age=86400, immutable',
            'Accept-Ranges' => 'bytes',
            'Content-Disposition' => 'inline; filename="' . $fileName . '"',
            'X-Content-Type-Options' => 'nosniff',
            'Content-Security-Policy' => "default-src 'none'",
        ];
        if (self::matches($request->header('if-none-match'), $etag)) {
            return new Response('', 304, $headers);
        }
        $range = $request->header('range');
        $ifRange = $request->header('if-range');
        if ($range !== null && ($ifRange === null || trim($ifRange) === $etag)) {
            $bounds = self::parseRange($range, $size);
            if ($bounds === false) {
                return new Response('', 416, ['Content-Range' => 'bytes */' . $size] + $headers);
            }
            if ($bounds !== null) {
                [$start, $end] = $bounds;

                return (new Response('', 206, $headers + [
                    'Content-Range' => 'bytes ' . $start . '-' . $end . '/' . $size,
                    'Content-Length' => (string) ($end - $start + 1),
                ]))->withFile($path, $start, $end - $start + 1);
            }
        }

        return (new Response('', 200, $headers + ['Content-Length' => (string) $size]))->withFile($path);
    }

    /**
     * Single byte range: [start, end] inclusive, null = ignore the header (malformed or several
     * ranges: the whole file is sent), false = unsatisfiable (416).
     *
     * @return array{0: int, 1: int}|null|false
     */
    public static function parseRange(string $header, int $size): array|null|false
    {
        if (preg_match('/^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i', $header, $m) !== 1 || ($m[1] === '' && $m[2] === '')) {
            return null;
        }
        if ($m[1] === '') {
            $suffix = (int) $m[2];
            if ($suffix === 0 || $size === 0) {
                return false;
            }

            return [max(0, $size - $suffix), $size - 1];
        }
        $start = (int) $m[1];
        $end = $m[2] === '' ? $size - 1 : min((int) $m[2], $size - 1);
        if ($start >= $size || $end < $start) {
            return false;
        }

        return [$start, $end];
    }

    private static function matches(?string $header, string $etag): bool
    {
        if ($header === null) {
            return false;
        }
        foreach (explode(',', $header) as $candidate) {
            $candidate = trim($candidate);
            if ($candidate === '*' || $candidate === $etag || $candidate === 'W/' . $etag) {
                return true;
            }
        }

        return false;
    }

    /**
     * ASCII-only file name for Content-Disposition (no quotes, no separators).
     */
    public static function fileName(string $name): string
    {
        $clean = trim((string) preg_replace('/[^A-Za-z0-9._ -]+/', '_', $name), ' ._');
        $clean = substr($clean, 0, 80);

        return $clean === '' ? 'image' : $clean;
    }
}
