<?php

declare(strict_types=1);

namespace JDR\Tests\Update;

use JDR\Core\Clock;
use JDR\Domain\Settings\Settings;
use JDR\Domain\Update\UpdateChecker;
use JDR\Install\HttpResult;
use JDR\Tests\Api\ApiTestCase;

final class UpdateCheckerTest extends ApiTestCase
{
    private const SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    private function checker(FakeReleaseHttp $http, string $current = '0.1.0', string $at = '2026-10-28 12:00:00'): UpdateChecker
    {
        $clock = new Clock(new \DateTimeImmutable($at, new \DateTimeZone('UTC')));

        return new UpdateChecker(new Settings($this->db, $clock), $clock, $http, $current);
    }

    private function http(): FakeReleaseHttp
    {
        return new FakeReleaseHttp([
            UpdateChecker::apiUrl() => FakeReleaseHttp::releases([
                FakeReleaseHttp::release('v0.4.0', false, true),          // draft: ignored
                FakeReleaseHttp::release('v0.3.0-beta.1', true),          // pre-release
                FakeReleaseHttp::release('v0.2.0'),
                FakeReleaseHttp::release('v0.1.0'),
                FakeReleaseHttp::release('not-a-version'),
            ]),
            FakeReleaseHttp::sumsUrl('v0.2.0') => new HttpResult(200, self::SHA . "  jdr-v0.2.0-full.zip\n"
                . strtoupper(str_repeat('b', 64)) . "  jdr-update-v0.2.0.zip\n"),
            FakeReleaseHttp::sumsUrl('v0.3.0-beta.1') => new HttpResult(200, self::SHA . " *jdr-update-v0.3.0-beta.1.zip\n"),
        ]);
    }

    public function testStableChannelPicksHighestStableAndReadsSums(): void
    {
        $http = $this->http();
        $result = $this->checker($http)->check();
        self::assertNull($result['error']);
        self::assertSame('stable', $result['channel']);
        self::assertSame('0.2.0', $result['latest']['version']);
        self::assertSame('JDR v0.2.0', $result['latest']['name']);
        self::assertSame('Notes v0.2.0', $result['latest']['notes']);
        self::assertSame('jdr-update-v0.2.0.zip', $result['latest']['update_asset']['name']);
        self::assertSame(str_repeat('b', 64), $result['latest']['update_asset']['sha256']);
        self::assertSame('2026-10-28T12:00:00Z', $result['checked_at']);
        $headers = $http->requests[0]['headers'];
        self::assertSame('application/vnd.github+json', $headers['Accept']);
        self::assertSame('JDR/0.1.0', $headers['User-Agent']);
        self::assertStringContainsString('collet-david-pro/JDR/releases?per_page=10', $http->requests[0]['url']);
    }

    public function testPrereleaseChannel(): void
    {
        // Default channel follows the running version.
        $result = $this->checker($this->http(), '0.1.0-alpha.1')->check();
        self::assertSame('prerelease', $result['channel']);
        self::assertSame('0.3.0-beta.1', $result['latest']['version']);
        self::assertSame(self::SHA, $result['latest']['update_asset']['sha256']);
        // Explicit setting wins.
        $checker = $this->checker($this->http());
        $checker->setChannel('prerelease');
        self::assertSame('0.3.0-beta.1', $checker->check(true)['latest']['version']);
        self::assertSame(self::SHA, $checker->officialHash('0.3.0-beta.1'));
        self::assertNull($checker->officialHash('0.2.0'));
    }

    public function testNothingNewerAndMissingSums(): void
    {
        $http = new FakeReleaseHttp([UpdateChecker::apiUrl() => FakeReleaseHttp::releases([FakeReleaseHttp::release('v0.1.0')])]);
        self::assertNull($this->checker($http)->check()['latest']);
        $http = new FakeReleaseHttp([UpdateChecker::apiUrl() => FakeReleaseHttp::releases([FakeReleaseHttp::release('v0.2.0', false, false, false)])]);
        $result = $this->checker($http)->check(true);
        self::assertNull($result['latest']['update_asset']['sha256']);
    }

    public function testCacheSixHoursAndForce(): void
    {
        $http = $this->http();
        $this->checker($http)->check();
        $calls = count($http->requests);
        $this->checker($http, '0.1.0', '2026-10-28 17:59:00')->check();
        self::assertCount($calls, $http->requests, 'cached for 6 h');
        $this->checker($http, '0.1.0', '2026-10-28 17:59:00')->check(true);
        self::assertCount($calls * 2, $http->requests, 'force bypasses the cache');
        $this->checker($http, '0.1.0', '2026-10-29 01:00:00')->check();
        self::assertCount($calls * 3, $http->requests, 'stale after 6 h');
        // Another running version invalidates the cache.
        $this->checker($http, '0.1.1', '2026-10-29 01:00:01')->check();
        self::assertCount($calls * 4, $http->requests);
    }

    public function testUnreachableAndInvalid(): void
    {
        $result = $this->checker(new FakeReleaseHttp([]))->check();
        self::assertSame('unreachable', $result['error']);
        self::assertNull($result['latest']);
        $result = $this->checker(new FakeReleaseHttp([UpdateChecker::apiUrl() => new HttpResult(200, '{"message":"x"}')]))->check(true);
        self::assertSame('invalid_response', $result['error']);
        $result = $this->checker(new FakeReleaseHttp([UpdateChecker::apiUrl() => new HttpResult(403, '[]')]))->check(true);
        self::assertSame('invalid_response', $result['error']);
        // A failure after a success keeps what was known.
        $this->checker($this->http())->check(true);
        $result = $this->checker(new FakeReleaseHttp([]))->check(true);
        self::assertSame('unreachable', $result['error']);
        self::assertSame('0.2.0', $result['latest']['version']);
    }

    public function testSumsParsing(): void
    {
        self::assertNull(UpdateChecker::sumFor("garbage\n", 'x.zip'));
        self::assertSame(self::SHA, UpdateChecker::sumFor("\r\n" . self::SHA . "  x.zip\r\n", 'x.zip'));
    }
}
