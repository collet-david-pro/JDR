<?php

declare(strict_types=1);

namespace JDR\Middleware;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\BadRequestException;
use JDR\Core\Errors\PayloadTooLargeException;
use JDR\Core\Errors\UnsupportedMediaTypeException;
use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Core\RouteMatch;

/**
 * Reads and limits the request body (1 MB by default) and decodes JSON into Request::parsedBody().
 * Routes with option raw_body (uploads, binary chunks) handle their body themselves.
 */
final class Json implements Middleware
{
    public const DEFAULT_MAX_BYTES = 1048576;

    public function __construct(private int $maxBytes = self::DEFAULT_MAX_BYTES)
    {
    }

    public function process(Request $request, callable $next): Response
    {
        $route = $request->attribute('route');
        if ($request->isSafeMethod() || ($route instanceof RouteMatch && $route->option('raw_body') === true)) {
            return $next($request);
        }
        $length = $request->header('content-length');
        if ($length !== null && ctype_digit($length) && (int) $length > $this->maxBytes) {
            throw new PayloadTooLargeException();
        }
        $body = $request->rawBody($this->maxBytes);
        if (trim($body) === '') {
            $request->setParsedBody([]);

            return $next($request);
        }
        $type = strtolower(trim(explode(';', (string) $request->header('content-type'))[0]));
        if ($type !== 'application/json') {
            throw new UnsupportedMediaTypeException();
        }
        try {
            $data = json_decode($body, true, 64, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new BadRequestException('', [], 'invalid_json');
        }
        if (!is_array($data)) {
            throw new BadRequestException('', [], 'invalid_json');
        }
        $request->setParsedBody($data);

        return $next($request);
    }
}
