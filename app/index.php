<?php

/*
 * Private folder: never served over HTTP. Answers 403 if .htaccess is ignored
 * (no JDR_BOOT guard here on purpose: this file is the guard).
 */

declare(strict_types=1);

http_response_code(403);
header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store');
echo 'Forbidden';
