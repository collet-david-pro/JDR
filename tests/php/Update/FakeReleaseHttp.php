<?php

declare(strict_types=1);

namespace JDR\Tests\Update;

use JDR\Domain\Update\ReleaseHttpClient;
use JDR\Install\HttpResult;

/**
 * Scripted HTTP client for the update check: URL => result (null = no answer). Unknown URLs give no answer.
 */
final class FakeReleaseHttp implements ReleaseHttpClient
{
    /** @var list<array{url:string,headers:array<string,string>}> */
    public array $requests = [];

    /**
     * @param array<string, HttpResult|null> $responses
     */
    public function __construct(public array $responses = [])
    {
    }

    public function get(string $url, array $headers = []): ?HttpResult
    {
        $this->requests[] = ['url' => $url, 'headers' => $headers];

        return $this->responses[$url] ?? null;
    }

    /**
     * @param list<array<string, mixed>> $releases
     */
    public static function releases(array $releases): HttpResult
    {
        return new HttpResult(200, (string) json_encode($releases));
    }

    /**
     * @return array<string, mixed>
     */
    public static function release(string $tag, bool $prerelease = false, bool $draft = false, bool $withSums = true): array
    {
        $version = ltrim($tag, 'v');
        $assets = [[
            'name' => 'jdr-update-v' . $version . '.zip',
            'browser_download_url' => 'https://github.com/x/releases/download/' . $tag . '/jdr-update-v' . $version . '.zip',
            'size' => 1234,
        ]];
        if ($withSums) {
            $assets[] = ['name' => 'SHA256SUMS', 'browser_download_url' => 'https://github.com/x/releases/download/' . $tag . '/SHA256SUMS', 'size' => 200];
        }

        return [
            'tag_name' => $tag, 'name' => 'JDR ' . $tag, 'draft' => $draft, 'prerelease' => $prerelease,
            'published_at' => '2026-10-20T10:00:00Z', 'body' => 'Notes ' . $tag,
            'html_url' => 'https://github.com/x/releases/tag/' . $tag, 'assets' => $assets,
        ];
    }

    public static function sumsUrl(string $tag): string
    {
        return 'https://github.com/x/releases/download/' . $tag . '/SHA256SUMS';
    }
}
