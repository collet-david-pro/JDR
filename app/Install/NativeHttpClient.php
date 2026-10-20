<?php

declare(strict_types=1);

namespace JDR\Install;

defined('JDR_BOOT') || exit;

/**
 * cURL when available, otherwise file_get_contents with a stream context. 5 s timeout, no redirects.
 *
 * TLS certificates are not verified: the installer only probes its own site for status codes
 * (no secret is sent, nothing from the answer is trusted), and self-signed or freshly issued
 * certificates must not turn the probe into a false negative.
 */
final class NativeHttpClient implements HttpClient
{
    private const MAX_BODY = 65536;

    public function __construct(private int $timeoutSeconds = 5)
    {
    }

    public function get(string $url): ?HttpResult
    {
        if (preg_match('#^https?://#i', $url) !== 1) {
            return null;
        }

        return function_exists('curl_init') ? $this->curl($url) : $this->stream($url);
    }

    private function curl(string $url): ?HttpResult
    {
        $ch = curl_init($url);
        if ($ch === false) {
            return null;
        }
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => $this->timeoutSeconds,
            CURLOPT_TIMEOUT => $this->timeoutSeconds,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => 0,
            CURLOPT_HTTPHEADER => ['Accept: application/json, text/plain, */*'],
            CURLOPT_USERAGENT => 'JDR-installer',
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
        ]);
        $body = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        if (!is_string($body) || $status === 0) {
            return null;
        }

        return new HttpResult($status, substr($body, 0, self::MAX_BODY));
    }

    private function stream(string $url): ?HttpResult
    {
        if (!(bool) ini_get('allow_url_fopen')) {
            return null;
        }
        $context = stream_context_create([
            'http' => [
                'method' => 'GET',
                'timeout' => $this->timeoutSeconds,
                'ignore_errors' => true,
                'follow_location' => 0,
                'max_redirects' => 1,
                'header' => "Accept: application/json, text/plain, */*\r\nUser-Agent: JDR-installer\r\n",
            ],
            'ssl' => ['verify_peer' => false, 'verify_peer_name' => false],
        ]);
        $body = @file_get_contents($url, false, $context, 0, self::MAX_BODY);
        // PHP >= 8.4: http_get_last_response_headers(); before: the magic local variable
        // (read through get_defined_vars() to avoid the 8.5 deprecation notice).
        $headers = function_exists('http_get_last_response_headers')
            ? (http_get_last_response_headers() ?? [])
            : (get_defined_vars()['http_response_header'] ?? []);
        if ($body === false && $headers === []) {
            return null;
        }
        $status = 0;
        foreach ($headers as $line) {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', (string) $line, $m) === 1) {
                $status = (int) $m[1]; // the last status line wins
            }
        }

        return $status === 0 ? null : new HttpResult($status, $body === false ? '' : $body);
    }
}
