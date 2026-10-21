<?php

declare(strict_types=1);

namespace JDR\Http\Controllers;

defined('JDR_BOOT') || exit;

use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Domain\Assets\FileServer;

/**
 * GET /files/{uuid}?t=full|thumb&e=&s= (public, no session: the signed URL is the authorization).
 */
final class FilesController
{
    public function __construct(private FileServer $files)
    {
    }

    public function show(Request $request): Response
    {
        return $this->files->serve($request, (string) $request->param('uuid'));
    }
}
