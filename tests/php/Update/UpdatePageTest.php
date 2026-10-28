<?php

declare(strict_types=1);

namespace JDR\Tests\Update;

use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Domain\Support\AppPaths;
use JDR\Domain\Update\ReleaseHttpClient;
use JDR\Domain\Update\UpdatePage;
use JDR\Tests\Api\ApiTestCase;

/**
 * update.php through UpdatePage::respond() (same pipeline as the real entry point), on a temporary installation.
 */
final class UpdatePageTest extends ApiTestCase
{
    private string $install;
    /** @var array<string, string> */
    private array $cookies = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->db->execute('DELETE FROM ' . $this->db->t('schema_migrations') . " WHERE `version` >= '0005'");
        Fixture::markRealMigrationsApplied($this->db);
        $this->install = Fixture::install(Fixture::oldFiles() + Fixture::realMigrations(), \APP_VERSION);
        $this->app->container()->instance(AppPaths::class, new AppPaths($this->install, $this->install . '/storage', $this->install));
        $this->app->container()->instance(ReleaseHttpClient::class, new FakeReleaseHttp());
        $this->createUser('Root', 'admin');
        $this->createUser('Player');
    }

    protected function tearDown(): void
    {
        Fixture::remove($this->install);
    }

    /**
     * @param array<string, string> $fields
     */
    private function page(string $method, string $uri = '/update.php', array $fields = [], bool $json = false): Response
    {
        $headers = ['User-Agent' => 'PHPUnit browser'];
        if ($method === 'POST') {
            $headers['Content-Type'] = 'application/x-www-form-urlencoded';
        }
        if ($json) {
            $headers['Accept'] = 'application/json';
        }
        $request = Request::create($method, $uri, $headers, http_build_query($fields), '', ['REMOTE_ADDR' => '203.0.113.10'], $this->cookies);
        $response = UpdatePage::respond($this->app, $request);
        foreach ($this->jar->drain() as $name => $cookie) {
            if ($cookie['value'] === '') {
                unset($this->cookies[$name]);
            } else {
                $this->cookies[$name] = $cookie['value'];
            }
        }

        return $response;
    }

    private static function csrf(Response $response): string
    {
        self::assertSame(1, preg_match('/name="_csrf" value="([0-9a-f]{64})"/', $response->body(), $m), $response->body());

        return $m[1];
    }

    private function login(string $user): Response
    {
        $csrf = self::csrf($this->page('GET'));

        return $this->page('POST', '/update.php', ['_csrf' => $csrf, 'action' => 'login', 'identifier' => $user, 'password' => self::PASSWORD]);
    }

    public function testAnonymousGetsTheLoginForm(): void
    {
        $response = $this->page('GET');
        self::assertSame(200, $response->status());
        self::assertStringContainsString('name="password"', $response->body());
        self::assertStringContainsString("script-src 'self' 'nonce-", (string) $response->header('Content-Security-Policy'));
        self::assertSame('no-store', $response->header('Cache-Control'));
        self::assertSame('noindex, nofollow', $response->header('X-Robots-Tag'));
    }

    public function testCsrfIsRequiredOnEveryPost(): void
    {
        $this->page('GET');
        $response = $this->page('POST', '/update.php', ['action' => 'login', 'identifier' => 'Root', 'password' => self::PASSWORD]);
        self::assertSame(403, $response->status());
        self::assertStringNotContainsString('name="password"', $response->body());
        self::assertSame(303, $this->login('Root')->status());
        // Logged in as admin: actions still need the token.
        self::assertSame(403, $this->page('POST', '/update.php', ['action' => 'start_disk'])->status());
        self::assertSame(403, $this->page('POST', '/update.php', ['action' => 'start_disk', '_csrf' => str_repeat('0', 64)], true)->status());
    }

    public function testLoginOutcomes(): void
    {
        $csrf = self::csrf($this->page('GET'));
        $wrong = $this->page('POST', '/update.php', ['_csrf' => $csrf, 'action' => 'login', 'identifier' => 'Root', 'password' => 'nope']);
        self::assertStringContainsString('Identifiants incorrects', $wrong->body());
        $player = $this->login('Player');
        self::assertStringContainsString('administrateur', $player->body());
        self::assertSame(403, $this->page('GET')->status(), 'a non-admin session is refused');

        self::assertSame(303, $this->login('Root')->status());
        $home = $this->page('GET');
        self::assertSame(200, $home->status());
        self::assertStringContainsString('Rien à mettre à jour', $home->body());
    }

    public function testPackageInstalledThroughThePage(): void
    {
        $this->login('Root');
        $zip = Fixture::zip($this->install . '/storage', Fixture::newFiles() + Fixture::realMigrations(), '0.2.0');
        $summary = $this->app->container()->get(\JDR\Domain\Update\UpdatePackage::class)->accept($zip, 1);
        $home = $this->page('GET');
        self::assertSame(303, $home->status());
        self::assertSame('/update.php?id=' . $summary['id'], $home->header('Location'));
        $page = $this->page('GET', '/update.php?id=' . $summary['id']);
        self::assertStringContainsString('name="confirm_unverified"', $page->body());
        $csrf = self::csrf($page);
        self::assertSame(422, $this->page('POST', '/update.php', ['_csrf' => $csrf, 'action' => 'start', 'id' => $summary['id']])->status());
        $start = $this->page('POST', '/update.php', ['_csrf' => $csrf, 'action' => 'start', 'id' => $summary['id'], 'confirm_unverified' => '1']);
        self::assertSame(303, $start->status());
        $run = $this->page('GET', '/update.php?id=' . $summary['id']);
        self::assertStringContainsString('id="step-form"', $run->body());
        self::assertStringContainsString('<script nonce="', $run->body());
        $state = null;
        for ($i = 0; $i < 50 && $state !== 'done'; $i++) {
            $step = $this->page('POST', '/update.php', ['_csrf' => $csrf, 'action' => 'step', 'id' => $summary['id']], true);
            self::assertSame(200, $step->status(), $step->body());
            $state = json_decode($step->body(), true)['run']['state'];
        }
        self::assertSame('done', $state);
        self::assertSame(hash('sha256', "<?php // front controller v2\n"), Fixture::snapshot($this->install)['index.php']);
        self::assertStringContainsString('La version 0.2.0 est installée', $this->page('GET', '/update.php?id=' . $summary['id'])->body());
    }

    public function testFilesSentByFtp(): void
    {
        $this->setSetting('app_version', '0.0.9');
        $this->login('Root');
        $home = $this->page('GET');
        self::assertStringContainsString('name="action" value="start_disk"', $home->body());
        $start = $this->page('POST', '/update.php', ['_csrf' => self::csrf($home), 'action' => 'start_disk']);
        self::assertSame(303, $start->status());
        $id = substr((string) $start->header('Location'), strlen('/update.php?id='));
        $state = null;
        for ($i = 0; $i < 20 && $state !== 'done'; $i++) {
            $state = json_decode($this->page('POST', '/update.php', ['_csrf' => self::csrf($home), 'action' => 'step', 'id' => $id], true)->body(), true)['run']['state'];
        }
        self::assertSame('done', $state);
        self::assertSame(\APP_VERSION, json_decode((string) $this->db->fetchValue('SELECT `value` FROM ' . $this->db->t('settings') . " WHERE `key` = 'app_version'"), true));
        self::assertStringContainsString('Rien à mettre à jour', $this->page('GET')->body());
    }

    public function testMaintenancePageLinksToUpdateWhenTheDatabaseIsBehind(): void
    {
        $this->setSetting('maintenance', true);
        $flagOnly = $this->app->handle(Request::create('GET', '/'));
        self::assertSame(503, $flagOnly->status());
        self::assertStringNotContainsString('update.php', $flagOnly->body());

        $this->setSetting('maintenance', false);
        $this->setSetting('db_version', '0003');
        $behind = $this->makeApp()->handle(Request::create('GET', '/campagnes'));
        self::assertSame(503, $behind->status());
        self::assertStringContainsString('href="/update.php"', $behind->body());
        $api = $this->makeApp()->handle(Request::create('GET', '/api/v1/auth/me'));
        self::assertSame(503, $api->status());
        self::assertSame('maintenance', self::errorCode($api));
    }
}
