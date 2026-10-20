<?php

declare(strict_types=1);

namespace JDR\Tests\Install;

use JDR\Install\HttpClient;
use JDR\Install\HttpResult;

/**
 * Scripted HTTP client: URL => result (null = no answer). Unknown URLs give no answer.
 */
final class FakeHttpClient implements HttpClient
{
    /** @var list<string> */
    public array $requested = [];

    /**
     * @param array<string, HttpResult|null> $responses
     */
    public function __construct(private array $responses = [])
    {
    }

    public function get(string $url): ?HttpResult
    {
        $this->requested[] = $url;
        foreach ($this->responses as $pattern => $result) {
            if ($pattern === $url || (str_ends_with($pattern, '*') && str_starts_with($url, substr($pattern, 0, -1)))) {
                return $result;
            }
        }

        return null;
    }

    public static function health(): HttpResult
    {
        return new HttpResult(200, '{"ok":true,"data":{"status":"ok","db":"not_configured","db_version":null},"meta":{}}');
    }
}
