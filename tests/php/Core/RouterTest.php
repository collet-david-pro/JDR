<?php

declare(strict_types=1);

namespace JDR\Tests\Core;

use JDR\Core\Errors\MethodNotAllowedException;
use JDR\Core\Errors\NotFoundException;
use JDR\Core\Request;
use JDR\Core\Router;
use PHPUnit\Framework\TestCase;

final class RouterTest extends TestCase
{
    private Router $router;

    protected function setUp(): void
    {
        $this->router = new Router();
        $noop = static fn () => null;
        $this->router->get('/health', $noop, ['maintenance_exempt' => true]);
        $this->router->get('/games/{id}', $noop);
        $this->router->patch('/games/{id}', $noop);
        $this->router->get('/games/{id:\d+}/members/{userId:\d+}', $noop);
        $this->router->post('/sessions/{id}/start', $noop);
    }

    public function testMatchesStaticRouteWithOptions(): void
    {
        $match = $this->router->match('GET', '/health');
        self::assertSame('/health', $match->pattern);
        self::assertTrue($match->option('maintenance_exempt'));
        self::assertSame([], $match->params);
    }

    public function testExtractsParameters(): void
    {
        $match = $this->router->match('GET', '/games/12');
        self::assertSame(['id' => '12'], $match->params);

        $match = $this->router->match('GET', '/games/7/members/42');
        self::assertSame(['id' => '7', 'userId' => '42'], $match->params);
    }

    public function testConstraintRejectsNonMatchingParameter(): void
    {
        $this->expectException(NotFoundException::class);
        $this->router->match('GET', '/games/7/members/abc');
    }

    public function testParameterDoesNotSpanSegments(): void
    {
        $this->expectException(NotFoundException::class);
        $this->router->match('GET', '/games/1/2');
    }

    public function testTrailingSlashIsIgnored(): void
    {
        self::assertSame(['id' => '3'], $this->router->match('GET', '/games/3/')->params);
    }

    public function testUnknownPathIs404(): void
    {
        try {
            $this->router->match('GET', '/nope');
            self::fail('Expected NotFoundException');
        } catch (NotFoundException $e) {
            self::assertSame(404, $e->status());
            self::assertSame('not_found', $e->errorCode());
        }
    }

    public function testWrongMethodIs405WithAllowHeader(): void
    {
        try {
            $this->router->match('DELETE', '/games/5');
            self::fail('Expected MethodNotAllowedException');
        } catch (MethodNotAllowedException $e) {
            self::assertSame(405, $e->status());
            self::assertSame(['GET', 'HEAD', 'PATCH'], $e->allowed());
            self::assertSame('GET, HEAD, PATCH', $e->headers()['Allow']);
        }
    }

    public function testHeadFallsBackToGet(): void
    {
        self::assertSame(['id' => '9'], $this->router->match('HEAD', '/games/9')->params);
    }

    public function testRegexCharactersInLiteralsAreEscaped(): void
    {
        $router = new Router();
        $router->get('/a.b', static fn () => null);
        $this->expectException(NotFoundException::class);
        $router->match('GET', '/axb');
    }

    /**
     * Both routing modes resolve to the same routed path, hence to the same route.
     *
     * @return iterable<string, array{string, string}>
     */
    public static function modeProvider(): iterable
    {
        yield 'rewrite' => ['/api/v1/games/12', ''];
        yield 'query' => ['/index.php?r=/api/v1/games/12', ''];
        yield 'query without index.php' => ['/?r=/api/v1/games/12', ''];
        yield 'path info' => ['/index.php/api/v1/games/12', ''];
        yield 'rewrite in sub-folder' => ['/jdr/api/v1/games/12', '/jdr'];
        yield 'query in sub-folder' => ['/jdr/index.php?r=%2Fapi%2Fv1%2Fgames%2F12', '/jdr'];
    }

    /**
     * @dataProvider modeProvider
     */
    public function testBothRoutingModesReachTheSameRoute(string $uri, string $basePath): void
    {
        $request = Request::create('GET', $uri, [], '', $basePath);
        self::assertSame('/api/v1/games/12', $request->path);
        self::assertArrayNotHasKey('r', $request->query);
        $match = $this->router->match('GET', substr($request->path, strlen('/api/v1')));
        self::assertSame(['id' => '12'], $match->params);
    }
}
