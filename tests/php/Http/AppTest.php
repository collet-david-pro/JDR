<?php

declare(strict_types=1);

namespace JDR\Tests\Http;

use JDR\Core\App;
use JDR\Core\Config;
use JDR\Core\Logger;
use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Core\SystemStatus;
use PHPUnit\Framework\TestCase;

/**
 * Kernel tests: full request -> response cycle, without HTTP server nor database.
 */
final class AppTest extends TestCase
{
    private string $root;

    protected function setUp(): void
    {
        $this->root = sys_get_temp_dir() . '/jdr-app-' . bin2hex(random_bytes(4));
        mkdir($this->root . '/assets', 0777, true);
    }

    protected function tearDown(): void
    {
        @unlink($this->root . '/assets/vite-manifest.json');
        @rmdir($this->root . '/assets');
        @rmdir($this->root);
    }

    private function app(?Config $config, ?SystemStatus $status = null): App
    {
        $app = App::create($this->root, $config, Logger::discard());
        if ($status !== null) {
            $app->container()->set(SystemStatus::class, static fn () => $status);
        }

        return $app;
    }

    private static function config(string $mode = 'rewrite', string $baseUrl = 'http://localhost:8000'): Config
    {
        return new Config([
            'base_url' => $baseUrl,
            'routing_mode' => $mode,
            'app_secret' => str_repeat('s', 64),
            'cron_key' => 'k',
            'db' => ['host' => '127.0.0.1', 'port' => 1, 'name' => 'x', 'user' => 'x', 'pass' => '', 'prefix' => 'x_'],
        ]);
    }

    private static function assertCommonHeaders(Response $response): void
    {
        self::assertMatchesRegularExpression('/^[0-9a-f]{16}$/', (string) $response->header('X-Request-Id'));
        self::assertSame(\APP_VERSION, $response->header('X-App-Version'));
        self::assertSame('1', $response->header('X-Protocol-Version'));
        self::assertStringStartsWith(
            "default-src 'self'; script-src 'self' 'nonce-",
            (string) $response->header('Content-Security-Policy'),
        );
        self::assertSame('nosniff', $response->header('X-Content-Type-Options'));
        self::assertSame('DENY', $response->header('X-Frame-Options'));
        self::assertSame('same-origin', $response->header('Referrer-Policy'));
        self::assertNotNull($response->header('Permissions-Policy'));
        self::assertSame('same-origin', $response->header('Cross-Origin-Opener-Policy'));
        self::assertSame('no-store', $response->header('Cache-Control'));
    }

    public function testHealthWithoutConfig(): void
    {
        $response = $this->app(null)->handle(Request::create('GET', '/api/v1/health'));
        self::assertSame(200, $response->status());
        self::assertSame(
            ['ok' => true, 'data' => ['status' => 'ok', 'db' => 'not_configured', 'db_version' => null], 'meta' => []],
            $response->payload(),
        );
        self::assertCommonHeaders($response);
        self::assertNull($response->header('Strict-Transport-Security'));
    }

    public function testHealthInBothRoutingModes(): void
    {
        $app = $this->app(self::config('query'), SystemStatus::fixed('ok', '0001'));
        foreach (['/api/v1/health', '/index.php?r=/api/v1/health', '/index.php?r=%2Fapi%2Fv1%2Fhealth'] as $uri) {
            $response = $app->handle(Request::create('GET', $uri));
            self::assertSame(200, $response->status(), $uri);
            self::assertSame(['status' => 'ok', 'db' => 'ok', 'db_version' => '0001'], $response->payload()['data']);
        }
    }

    public function testHealthWithUnreachableDatabase(): void
    {
        $response = $this->app(self::config())->handle(Request::create('GET', '/api/v1/health'));
        self::assertSame(200, $response->status());
        self::assertSame('error', $response->payload()['data']['db']);
    }

    public function testHealthIsAvailableDuringMaintenance(): void
    {
        $app = $this->app(self::config(), SystemStatus::fixed('ok', '0001', true));
        self::assertSame(200, $app->handle(Request::create('GET', '/api/v1/health'))->status());
        self::assertSame(200, $app->handle(Request::create('GET', '/api/v1/version'))->status());
    }

    public function testVersion(): void
    {
        $response = $this->app(null)->handle(Request::create('GET', '/api/v1/version'));
        self::assertSame(200, $response->status());
        self::assertSame(
            ['version' => \APP_VERSION, 'protocol' => 1, 'required_db_version' => \REQUIRED_DB_VERSION],
            $response->payload()['data'],
        );
    }

    public function testUnknownApiRouteIs404Envelope(): void
    {
        $app = $this->app(self::config(), SystemStatus::fixed('ok', '0001'));
        foreach (['/api/v1/nope', '/api/v2/health', '/api'] as $uri) {
            $response = $app->handle(Request::create('GET', $uri));
            self::assertSame(404, $response->status(), $uri);
            $payload = $response->payload();
            self::assertFalse($payload['ok']);
            self::assertSame('not_found', $payload['error']['code']);
            self::assertNotSame('', $payload['error']['message']);
            self::assertSame([], $payload['error']['fields']);
            self::assertCommonHeaders($response);
        }
    }

    public function testWrongMethodIs405(): void
    {
        $response = $this->app(null)->handle(Request::create('POST', '/api/v1/health'));
        self::assertSame(405, $response->status());
        self::assertSame('method_not_allowed', $response->payload()['error']['code']);
        self::assertSame('GET, HEAD', $response->header('Allow'));
    }

    public function testMaintenanceReturns503WithRetryAfter(): void
    {
        $app = $this->app(self::config(), SystemStatus::fixed('ok', '0001', true));
        $page = $app->handle(Request::create('GET', '/games/12'));
        self::assertSame(503, $page->status());
        self::assertSame('120', $page->header('Retry-After'));
        self::assertStringContainsString('Maintenance', $page->body());
        self::assertCommonHeaders($page);
    }

    public function testDatabaseBehindCodeTriggersMaintenance(): void
    {
        $app = $this->app(self::config(), SystemStatus::fixed('ok', '0000'));
        self::assertSame(503, $app->handle(Request::create('GET', '/'))->status());
    }

    public function testSpaRouteWithoutBuildShowsNotBuiltPage(): void
    {
        $response = $this->app(self::config(), SystemStatus::fixed('ok', '0001'))
            ->handle(Request::create('GET', '/games/12'));
        self::assertSame(200, $response->status());
        self::assertStringContainsString('Front-end non compilé', $response->body());
        self::assertStringContainsString('npm run build', $response->body());
        self::assertCommonHeaders($response);
    }

    public function testSpaShellWithBuild(): void
    {
        file_put_contents($this->root . '/assets/vite-manifest.json', json_encode([
            'src/main.ts' => [
                'file' => 'assets/main-AbC123.js',
                'src' => 'src/main.ts',
                'isEntry' => true,
                'css' => ['assets/main-Def456.css'],
                'imports' => ['_shared-X1.js'],
            ],
            '_shared-X1.js' => ['file' => 'assets/shared-X1.js', 'css' => ['assets/shared-Y2.css']],
        ]));
        $app = $this->app(self::config('rewrite', 'https://example.org/jdr'), SystemStatus::fixed('ok', '0001'));
        $response = $app->handle(Request::create('GET', '/jdr/games/12', [], '', '/jdr', ['HTTPS' => 'on']));
        self::assertSame(200, $response->status());
        self::assertSame('text/html; charset=utf-8', $response->header('Content-Type'));
        $html = $response->body();
        preg_match("/'nonce-([^']+)'/", (string) $response->header('Content-Security-Policy'), $m);
        self::assertNotEmpty($m[1] ?? '');
        self::assertStringContainsString(
            '<script type="module" nonce="' . $m[1] . '" src="/jdr/assets/assets/main-AbC123.js"></script>',
            $html,
        );
        self::assertStringContainsString('<link rel="stylesheet" href="/jdr/assets/assets/main-Def456.css">', $html);
        self::assertStringContainsString('<link rel="stylesheet" href="/jdr/assets/assets/shared-Y2.css">', $html);
        self::assertStringContainsString('<link rel="modulepreload" href="/jdr/assets/assets/shared-X1.js">', $html);
        self::assertMatchesRegularExpression('#<script id="jdr-boot" type="application/json">(.+?)</script>#', $html);
        preg_match('#<script id="jdr-boot" type="application/json">(.+?)</script>#', $html, $boot);
        self::assertSame([
            'version' => \APP_VERSION,
            'api_base' => '/jdr/api/v1',
            'routing_mode' => 'rewrite',
            'base_path' => '/jdr',
            'csrf' => null,
        ], json_decode($boot[1], true));
        self::assertSame('max-age=15552000', $response->header('Strict-Transport-Security'));
    }

    public function testQueryModeBootData(): void
    {
        file_put_contents($this->root . '/assets/vite-manifest.json', '{"src/main.ts":{"file":"assets/m.js"}}');
        $response = $this->app(self::config('query'), SystemStatus::fixed('ok', '0001'))
            ->handle(Request::create('GET', '/index.php'));
        preg_match('#<script id="jdr-boot" type="application/json">(.+?)</script>#', $response->body(), $boot);
        $data = json_decode($boot[1], true);
        self::assertSame('/index.php?r=/api/v1', $data['api_base']);
        self::assertSame('query', $data['routing_mode']);
    }

    public function testMissingConfigRedirectsPagesToInstaller(): void
    {
        $response = $this->app(null)->handle(Request::create('GET', '/games/12', [], '', '/jdr'));
        self::assertSame(302, $response->status());
        self::assertSame('/jdr/install.php', $response->header('Location'));
        // No redirect loop when install.php itself is missing.
        self::assertSame(404, $this->app(null)->handle(Request::create('GET', '/install.php'))->status());
    }

    public function testMissingConfigApiIs503(): void
    {
        $app = $this->app(null);
        \Closure::bind(function (): void {
            $this->router->get('/needs-install', static fn () => Response::ok());
        }, $app, App::class)();
        $response = $app->handle(Request::create('GET', '/api/v1/needs-install'));
        self::assertSame(503, $response->status());
        self::assertSame('maintenance', $response->payload()['error']['code']);
        self::assertSame('Le site n\'est pas encore installé.', $response->payload()['error']['message']);
    }

    public function testPrivatePathsAreRefused(): void
    {
        $app = $this->app(self::config(), SystemStatus::fixed('ok', '0001'));
        $uris = ['/app/bootstrap.php', '/storage/', '/config.php', '/migrations/', '/i18n/fr.json', '/index.php?r=/app/x'];
        foreach ($uris as $uri) {
            self::assertSame(403, $app->handle(Request::create('GET', $uri))->status(), $uri);
        }
    }

    public function testMissingStaticFilesAre404NotShell(): void
    {
        $app = $this->app(self::config(), SystemStatus::fixed('ok', '0001'));
        foreach (['/assets/missing.js', '/sw.js', '/favicon.ico'] as $uri) {
            $response = $app->handle(Request::create('GET', $uri));
            self::assertSame(404, $response->status(), $uri);
            self::assertStringContainsString('Page introuvable', $response->body());
        }
    }

    public function testNonGetPageIs405(): void
    {
        $app = $this->app(self::config(), SystemStatus::fixed('ok', '0001'));
        self::assertSame(405, $app->handle(Request::create('POST', '/games/1'))->status());
    }

    public function testNonGetApiRequiresCsrfUntilP1(): void
    {
        $app = $this->app(self::config(), SystemStatus::fixed('ok', '0001'));
        \Closure::bind(function (): void {
            $this->router->post('/echo', static fn (Request $r) => Response::ok($r->parsedBody()));
            $this->router->post('/open', static fn (Request $r) => Response::ok($r->parsedBody()), ['csrf' => false]);
        }, $app, App::class)();
        $json = ['Content-Type' => 'application/json'];

        self::assertSame(403, $app->handle(Request::create('POST', '/api/v1/echo', $json, '{"a":1}'))->status());

        $ok = $app->handle(Request::create('POST', '/api/v1/open', $json, '{"id":5}'));
        self::assertSame(200, $ok->status());
        self::assertSame(['id' => '5'], $ok->payload()['data']);

        $bad = $app->handle(Request::create('POST', '/api/v1/open', $json, '{bad'));
        self::assertSame(400, $bad->status());
        self::assertSame('invalid_json', $bad->payload()['error']['code']);

        $type = $app->handle(Request::create('POST', '/api/v1/open', ['Content-Type' => 'text/plain'], 'x'));
        self::assertSame(415, $type->status());
        self::assertSame('unsupported_type', $type->payload()['error']['code']);

        $big = $app->handle(Request::create('POST', '/api/v1/open', $json, '"' . str_repeat('a', 1048577) . '"'));
        self::assertSame(413, $big->status());
        self::assertSame('payload_too_large', $big->payload()['error']['code']);
    }

    public function testUnhandledExceptionIs500WithoutDetails(): void
    {
        $app = $this->app(self::config(), SystemStatus::fixed('ok', '0001'));
        \Closure::bind(function (): void {
            $this->router->get('/boom', static function (): Response {
                throw new \LogicException('secret detail');
            });
        }, $app, App::class)();
        $response = $app->handle(Request::create('GET', '/api/v1/boom'));
        self::assertSame(500, $response->status());
        self::assertSame('internal_error', $response->payload()['error']['code']);
        self::assertStringNotContainsString('secret detail', $response->body());
        self::assertCommonHeaders($response);
    }
}
