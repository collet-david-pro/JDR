<?php

declare(strict_types=1);

namespace JDR\Domain\Update;

defined('JDR_BOOT') || exit;

/**
 * HTTPS download with curl, else streams (like NativeReleaseHttpClient), written to disk as it comes.
 */
final class NativeReleaseDownloader implements ReleaseDownloader
{
    public function __construct(private int $timeoutSeconds = 120)
    {
    }

    /**
     * Streams the URL to the file, giving up when it exceeds the byte limit; returns success.
     */
    public function download(string $url, string $path, int $maxBytes): bool
    {
        if (preg_match('#^https://#i', $url) !== 1) {
            return false;
        }
        $out = @fopen($path, 'wb');
        if ($out === false) {
            return false;
        }
        $ok = function_exists('curl_init') ? $this->curl($url, $out, $maxBytes) : $this->stream($url, $out, $maxBytes);
        fclose($out);
        if (!$ok) {
            @unlink($path);
        }

        return $ok;
    }

    /**
     * @param resource $out
     */
    private function curl(string $url, $out, int $maxBytes): bool
    {
        $ch = curl_init($url);
        if ($ch === false) {
            return false;
        }
        $written = 0;
        curl_setopt_array($ch, [
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 5,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => $this->timeoutSeconds,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_USERAGENT => 'JDR/' . \APP_VERSION,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_WRITEFUNCTION => static function ($ch, string $data) use ($out, $maxBytes, &$written): int {
                $written += strlen($data);
                if ($written > $maxBytes || fwrite($out, $data) !== strlen($data)) {
                    return 0; // aborts the transfer
                }

                return strlen($data);
            },
        ]);
        $ok = curl_exec($ch);

        return $ok !== false && (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE) === 200;
    }

    /**
     * @param resource $out
     */
    private function stream(string $url, $out, int $maxBytes): bool
    {
        if (!(bool) ini_get('allow_url_fopen')) {
            return false;
        }
        $context = stream_context_create([
            'http' => [
                'method' => 'GET',
                'timeout' => $this->timeoutSeconds,
                'ignore_errors' => true,
                'follow_location' => 1,
                'max_redirects' => 6,
                'header' => 'User-Agent: JDR/' . \APP_VERSION . "\r\n",
            ],
            'ssl' => ['verify_peer' => true, 'verify_peer_name' => true],
        ]);
        $in = @fopen($url, 'rb', false, $context);
        if ($in === false) {
            return false;
        }
        $status = 0;
        foreach ((array) (stream_get_meta_data($in)['wrapper_data'] ?? []) as $line) {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', (string) $line, $m) === 1) {
                $status = (int) $m[1]; // the last status line wins (after redirects)
            }
        }
        $copied = $status === 200 ? stream_copy_to_stream($in, $out, $maxBytes + 1) : false;
        fclose($in);

        return $copied !== false && $copied <= $maxBytes;
    }
}
