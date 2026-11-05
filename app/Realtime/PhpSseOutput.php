<?php

declare(strict_types=1);

namespace JDR\Realtime;

defined('JDR_BOOT') || exit;

/**
 * SSE straight to the client (projet.md 10.3): session lock released, no time limit beyond
 * 40 s, compression and output buffers disabled, headers sent at once, flush() after each block.
 */
final class PhpSseOutput implements SseOutput
{
    /**
     * Sends the status and SSE headers.
     */
    public function start(array $headers): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_write_close();
        }
        ignore_user_abort(false);
        @set_time_limit(40);
        @ini_set('zlib.output_compression', '0');
        @ini_set('output_buffering', '0');
        @ini_set('implicit_flush', '1');
        if (function_exists('apache_setenv')) {
            @apache_setenv('no-gzip', '1');
        }
        while (ob_get_level() > 0) {
            ob_end_flush();
        }
        if (!headers_sent()) {
            http_response_code(200);
            foreach ($headers as $name => $value) {
                header($name . ': ' . $value, true);
            }
        }
    }

    /**
     * Echoes the data to the client.
     */
    public function write(string $data): void
    {
        echo $data;
    }

    /**
     * Flushes the output buffers to the client.
     */
    public function flush(): void
    {
        flush();
    }

    /**
     * Tells whether the client closed the connection.
     */
    public function aborted(): bool
    {
        return connection_aborted() === 1;
    }
}
