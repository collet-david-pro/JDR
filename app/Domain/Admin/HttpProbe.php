<?php

declare(strict_types=1);

namespace JDR\Domain\Admin;

defined('JDR_BOOT') || exit;

/**
 * Minimal HTTP GET (raw socket, no extension needed) returning the status code, or null when the
 * server cannot be reached in time (e.g. a single-process development server calling itself).
 */
final class HttpProbe
{
    public function status(string $url, int $timeout = 2): ?int
    {
        $parts = parse_url($url);
        if (!is_array($parts) || !isset($parts['host'], $parts['scheme'])) {
            return null;
        }
        $https = strtolower($parts['scheme']) === 'https';
        $port = (int) ($parts['port'] ?? ($https ? 443 : 80));
        $path = ($parts['path'] ?? '/') . (isset($parts['query']) ? '?' . $parts['query'] : '');
        $context = stream_context_create(['ssl' => ['verify_peer' => false, 'verify_peer_name' => false]]);
        $errno = 0;
        $errstr = '';
        $stream = @stream_socket_client(
            ($https ? 'ssl://' : 'tcp://') . $parts['host'] . ':' . $port,
            $errno,
            $errstr,
            $timeout,
            STREAM_CLIENT_CONNECT,
            $context,
        );
        if ($stream === false) {
            return null;
        }
        stream_set_timeout($stream, $timeout);
        $host = $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '');
        @fwrite($stream, "GET {$path} HTTP/1.1\r\nHost: {$host}\r\nUser-Agent: JDR-diagnostic\r\nConnection: close\r\n\r\n");
        $line = @fgets($stream, 512);
        @fclose($stream);
        if (!is_string($line) || preg_match('#^HTTP/\d(?:\.\d)?\s+(\d{3})#', $line, $m) !== 1) {
            return null;
        }

        return (int) $m[1];
    }
}
