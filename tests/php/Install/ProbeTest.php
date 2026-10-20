<?php

declare(strict_types=1);

namespace JDR\Tests\Install;

use JDR\Install\Check;
use JDR\Install\HttpResult;
use JDR\Install\Probe;
use PHPUnit\Framework\TestCase;

final class ProbeTest extends TestCase
{
    private const BASE = 'https://example.org/jdr';

    public function testRewriteDetectedWhenCleanUrlAnswersHealth(): void
    {
        $http = new FakeHttpClient([self::BASE . '/api/v1/health' => FakeHttpClient::health()]);
        $check = (new Probe($http))->routingMode(self::BASE . '/');

        self::assertSame('rewrite', $check->value);
        self::assertSame(Check::OK, $check->status);
        self::assertSame([self::BASE . '/api/v1/health'], $http->requested);
    }

    public function testQueryModeWhenOnlyIndexPhpAnswers(): void
    {
        $http = new FakeHttpClient([
            self::BASE . '/api/v1/health' => new HttpResult(404, '<h1>Not Found</h1>'),
            self::BASE . '/index.php?r=/api/v1/health' => FakeHttpClient::health(),
        ]);
        $check = (new Probe($http))->routingMode(self::BASE);

        self::assertSame('query', $check->value);
        self::assertSame(Check::WARN, $check->status);
        self::assertSame('req.routing.query', $check->hint);
    }

    public function testHtmlPageWith200IsNotMistakenForTheApi(): void
    {
        $http = new FakeHttpClient([
            self::BASE . '/api/v1/health' => new HttpResult(200, '<html>hosting placeholder</html>'),
            self::BASE . '/index.php?r=/api/v1/health' => FakeHttpClient::health(),
        ]);

        self::assertSame('query', (new Probe($http))->routingMode(self::BASE)->value);
    }

    public function testNoAnswerFallsBackToQueryWithWarning(): void
    {
        $check = (new Probe(new FakeHttpClient()))->routingMode(self::BASE);

        self::assertSame('query', $check->value);
        self::assertSame(Check::WARN, $check->status);
        self::assertSame('req.routing.unreachable', $check->hint);
    }

    public function testServerErrorIsBlocking(): void
    {
        $http = new FakeHttpClient([self::BASE . '/*' => new HttpResult(500, 'Internal Server Error')]);
        $check = (new Probe($http))->routingMode(self::BASE);

        self::assertSame(Check::ERROR, $check->status);
        self::assertSame('req.routing.server_error', $check->hint);
    }

    public function testBrokenRoutingIsBlocking(): void
    {
        $http = new FakeHttpClient([self::BASE . '/*' => new HttpResult(404, 'nope')]);

        self::assertSame(Check::ERROR, (new Probe($http))->routingMode(self::BASE)->status);
    }

    public function testPrivateFileProtection(): void
    {
        $url = self::BASE . '/app/canary.txt';
        $probe = static fn (?HttpResult $r): Check => (new Probe(new FakeHttpClient([$url => $r])))
            ->privateFile('protect_app', $url, 'req.protect_app');

        self::assertSame(Check::OK, $probe(new HttpResult(403, 'Forbidden'))->status);
        self::assertSame(Check::OK, $probe(new HttpResult(404, 'Not found'))->status);
        self::assertSame(Check::ERROR, $probe(new HttpResult(200, Probe::CANARY_MARKER . "\n"))->status);
        self::assertSame(Check::WARN, $probe(new HttpResult(200, '<html>home page</html>'))->status);
        self::assertSame(Check::WARN, $probe(null)->status);
        self::assertSame(['url' => $url], $probe(null)->params);
    }

    public function testCanaryFileCarriesTheMarker(): void
    {
        self::assertStringContainsString(Probe::CANARY_MARKER, (string) file_get_contents(\JDR_ROOT . '/app/canary.txt'));
    }
}
