<?php

declare(strict_types=1);

namespace JDR\Domain\Update;

defined('JDR_BOOT') || exit;

use JDR\Install\HttpResult;

/**
 * cURL when available, else file_get_contents. TLS certificates ARE verified (unlike the installer's
 * self-probe): the answer decides which version is offered and which archive hash is official.
 * HTTPS only, at most 5 redirects, 5 s timeout, body capped.
 */
final class NativeReleaseHttpClient implements ReleaseHttpClient
{
    public const MAX_BODY = 4194304;

    public function __construct(private int $timeoutSeconds = 5)
    {
    }

    public function get(string $url, array $headers = []): ?HttpResult
    {
        if (preg_match('#^https://#i', $url) !== 1) {
            return null;
        }
        $lines = [];
        foreach ($headers as $name => $value) {
            $lines[] = $name . ': ' . str_replace(["\r", "\n"], '', $value);
        }

        return function_exists('curl_init') ? $this->curl($url, $lines) : $this->stream($url, $lines);
    }

    /**
     * @param list<string> $headers
     */
    private function curl(string $url, array $headers): ?HttpResult
    {
        $ch = curl_init($url);
        if ($ch === false) {
            return null;
        }
        $body = '';
        $tooLarge = false;
        curl_setopt_array($ch, [
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 5,
            CURLOPT_CONNECTTIMEOUT => $this->timeoutSeconds,
            CURLOPT_TIMEOUT => $this->timeoutSeconds,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_WRITEFUNCTION => static function ($ch, string $data) use (&$body, &$tooLarge): int {
                if (strlen($body) + strlen($data) > self::MAX_BODY) {
                    $tooLarge = true;

                    return 0; // aborts the transfer
                }
                $body .= $data;

                return strlen($data);
            },
        ]);
        $ok = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        if ($ok === false || $tooLarge || $status === 0) {
            return null;
        }

        return new HttpResult($status, $body);
    }

    /**
     * @param list<string> $headers
     */
    private function stream(string $url, array $headers): ?HttpResult
    {
        if (!(bool) ini_get('allow_url_fopen')) {
            return null;
        }
        $context = stream_context_create([
            'http' => [
                'method' => 'GET',
                'timeout' => $this->timeoutSeconds,
                'ignore_errors' => true,
                'follow_location' => 1,
                'max_redirects' => 6,
                'header' => implode("\r\n", $headers) . "\r\n",
            ],
            'ssl' => ['verify_peer' => true, 'verify_peer_name' => true],
        ]);
        $body = @file_get_contents($url, false, $context, 0, self::MAX_BODY + 1);
        $responseHeaders = function_exists('http_get_last_response_headers')
            ? (http_get_last_response_headers() ?? [])
            : (get_defined_vars()['http_response_header'] ?? []);
        if ($body === false || strlen($body) > self::MAX_BODY) {
            return null;
        }
        $status = 0;
        foreach ($responseHeaders as $line) {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', (string) $line, $m) === 1) {
                $status = (int) $m[1]; // the last status line wins (after redirects)
            }
        }

        return $status === 0 ? null : new HttpResult($status, $body);
    }
}
