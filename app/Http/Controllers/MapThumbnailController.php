<?php

declare(strict_types=1);

namespace JDR\Http\Controllers;

defined('JDR_BOOT') || exit;

use JDR\Core\Config;
use JDR\Core\Errors\PayloadTooLargeException;
use JDR\Core\Errors\ValidationException;
use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Domain\Assets\AssetLimits;
use JDR\Domain\Assets\AssetStorage;
use JDR\Domain\Assets\Input;
use JDR\Domain\Assets\UploadedFile;
use JDR\Domain\Auth\CurrentUser;
use JDR\Domain\Maps\Transfer\MapThumbnailService;

/**
 * Map thumbnails (contract P4c):
 * - PUT /maps/{id}/thumbnail: body = the image (PNG / WebP, <= 512 px, <= 512 KB), raw or
 *   multipart (field "file"; PHP does not parse multipart PUT bodies, so it is parsed here,
 *   within the size bound) -> {thumb_url}. Rights (GM / co-GM) are checked before the body is read.
 * - GET /map-thumbs/{id}?v=&e=&s= (public, signed URL).
 */
final class MapThumbnailController
{
    public function __construct(
        private MapThumbnailService $thumbs,
        private AssetStorage $storage,
        private ?Config $config = null,
    ) {
    }

    public function update(Request $request): Response
    {
        $user = CurrentUser::require($request);
        $mapId = (int) $request->param('id');
        $this->thumbs->requireEditable($user, $mapId);
        $max = MapThumbnailService::MAX_BYTES;
        $length = $request->header('content-length');
        if ($length !== null && ctype_digit($length) && (int) $length > $max + AssetLimits::MULTIPART_MARGIN) {
            throw new PayloadTooLargeException('', [], 'file_too_large');
        }
        $tmp = $this->storage->newTmpPath();
        try {
            $file = UploadedFile::fromRequest($request, 'file');
            if ($file !== null && $request->attribute('multipart_files') !== null) {
                // Tests hand the multipart file over as a request attribute.
                if ($file->error !== UPLOAD_ERR_OK || !$file->moveTo($tmp)) {
                    throw new ValidationException('', ['file' => 'invalid']);
                }
            } else {
                try {
                    $body = $request->rawBody($max + AssetLimits::MULTIPART_MARGIN);
                } catch (PayloadTooLargeException) {
                    throw new PayloadTooLargeException('', [], 'file_too_large');
                }
                $type = strtolower(trim(explode(';', (string) $request->header('content-type'))[0]));
                if ($type === 'multipart/form-data') {
                    $body = self::multipartFile($body, (string) $request->header('content-type'));
                }
                if ($body === '') {
                    throw new ValidationException('', ['file' => 'required']);
                }
                if (strlen($body) > $max) {
                    throw new PayloadTooLargeException('', [], 'file_too_large');
                }
                if (@file_put_contents($tmp, $body) !== strlen($body)) {
                    throw new \RuntimeException('Cannot write the thumbnail to storage/tmp.');
                }
            }
            $map = $this->thumbs->store($user, $mapId, $tmp);
        } finally {
            $this->storage->remove($tmp);
        }

        return Response::ok(['thumb_url' => $this->thumbs->url(Input::apiBase($request, $this->config), $map)]);
    }

    public function show(Request $request): Response
    {
        return $this->thumbs->serve($request, (int) $request->param('id'));
    }

    /**
     * Content of the part named "file" of a multipart body ('' when absent).
     *
     * @throws ValidationException
     */
    private static function multipartFile(string $body, string $contentType): string
    {
        if (preg_match('/boundary="?([^";]{1,200})"?/i', $contentType, $m) !== 1) {
            throw new ValidationException('', ['file' => 'invalid']);
        }
        $delimiter = '--' . $m[1];
        foreach (explode($delimiter, $body) as $part) {
            $split = strpos($part, "\r\n\r\n");
            if ($split === false) {
                continue;
            }
            $headers = substr($part, 0, $split);
            if (preg_match('/^content-disposition:\s*form-data;[^\r\n]*\bname="file"/im', $headers) !== 1) {
                continue;
            }
            $content = substr($part, $split + 4);

            return str_ends_with($content, "\r\n") ? substr($content, 0, -2) : $content;
        }

        return '';
    }
}
