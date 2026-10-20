<?php

declare(strict_types=1);

namespace JDR\Tests\Core;

use JDR\Core\Config;
use JDR\Core\Errors\PayloadTooLargeException;
use JDR\Core\Request;
use PHPUnit\Framework\TestCase;

final class RequestTest extends TestCase
{
    public function testQueryParametersExcludeRoute(): void
    {
        $request = Request::create('GET', '/index.php?r=/api/v1/assets&cursor=abc&limit=10');
        self::assertSame('/api/v1/assets', $request->path);
        self::assertSame(['cursor' => 'abc', 'limit' => '10'], $request->query);
    }

    public function testPathNormalization(): void
    {
        self::assertSame('/', Request::create('GET', '/')->path);
        self::assertSame('/', Request::create('GET', '/index.php')->path);
        self::assertSame('/games/12', Request::create('GET', '//games///12/')->path);
        self::assertSame('/games/12', Request::create('GET', '/games/%31%32')->path);
    }

    public function testRouteParameterIgnoredOutsideRoot(): void
    {
        self::assertSame('/games', Request::create('GET', '/games?r=/api/v1/health')->path);
    }

    public function testBasePathFromConfigOrScriptName(): void
    {
        $config = new Config(['base_url' => 'https://example.org/jdr/']);
        self::assertSame('/jdr', Request::resolveBasePath($config, [], '/jdr/games/1'));
        // Request outside the configured base path: fall back to SCRIPT_NAME.
        self::assertSame('/other', Request::resolveBasePath($config, ['SCRIPT_NAME' => '/other/index.php'], '/other/x'));
        self::assertSame('', Request::resolveBasePath(null, ['SCRIPT_NAME' => '/index.php'], '/games/1'));
        self::assertSame('/sub', Request::resolveBasePath(null, ['SCRIPT_NAME' => '/sub/index.php'], '/sub/'));
    }

    public function testHeadersAreCaseInsensitive(): void
    {
        $request = Request::create('POST', '/api/v1/x', ['X-CSRF-Token' => 'abc', 'Content-Type' => 'application/json']);
        self::assertSame('abc', $request->header('x-csrf-token'));
        self::assertSame('application/json', $request->header('CONTENT-TYPE'));
        self::assertTrue($request->isApi());
        self::assertFalse($request->isSafeMethod());
    }

    public function testHttpsDetection(): void
    {
        self::assertFalse(Request::create('GET', '/')->isHttps());
        self::assertTrue(Request::create('GET', '/', [], '', '', ['HTTPS' => 'on'])->isHttps());
        self::assertFalse(Request::create('GET', '/', [], '', '', ['HTTPS' => 'off'])->isHttps());
        $proxied = Request::create('GET', '/', ['X-Forwarded-Proto' => 'https']);
        self::assertFalse($proxied->isHttps());
        self::assertTrue($proxied->isHttps(true));
    }

    public function testBodyLimit(): void
    {
        $request = Request::create('POST', '/api/v1/x', [], str_repeat('a', 11));
        self::assertSame(11, strlen($request->rawBody(11)));
        $this->expectException(PayloadTooLargeException::class);
        $request->rawBody(10);
    }

    public function testIdsAreUniqueHex(): void
    {
        $a = Request::newId();
        self::assertMatchesRegularExpression('/^[0-9a-f]{16}$/', $a);
        self::assertNotSame($a, Request::newId());
    }
}
