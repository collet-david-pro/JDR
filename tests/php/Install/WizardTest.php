<?php

declare(strict_types=1);

namespace JDR\Tests\Install;

use JDR\Core\Db;
use JDR\Install\Env;
use JDR\Install\Installer;
use JDR\Install\Reply;
use JDR\Install\State;

/**
 * The whole wizard through the controller (no browser): forms, redirects, no-JS and JSON step 5.
 */
final class WizardTest extends InstallDbTestCase
{
    private const PASSWORD = 'Une phrase de passe solide';

    private Db $db;
    private string $root;
    private State $state;
    private FakeHttpClient $http;

    protected function setUp(): void
    {
        $this->db = self::installDb();
        self::dropTestTables($this->db);
        $this->root = TempRoot::create(true);
        $this->state = State::memory();
        $this->http = new FakeHttpClient(['http://example.org/api/v1/health' => FakeHttpClient::health()]);
    }

    protected function tearDown(): void
    {
        TempRoot::remove($this->root);
        self::dropTestTables($this->db);
    }

    /**
     * @param array<string, mixed> $get
     * @param array<string, mixed> $post
     */
    private function request(string $method, array $get, array $post = []): Reply
    {
        $env = new Env($this->root, ['REQUEST_METHOD' => $method, 'HTTP_HOST' => 'example.org', 'SCRIPT_NAME' => '/install.php']);
        if ($method === 'POST') {
            $post += ['_token' => $this->state->token()];
        }

        return (new Installer($env, $this->state, $this->http, 'test-nonce'))->handle($get, $post);
    }

    private function post(string $step, array $post): Reply
    {
        return $this->request('POST', ['step' => $step], $post);
    }

    private function fillSteps1To4(): void
    {
        $page = $this->request('GET', []);
        self::assertSame(200, $page->status);
        self::assertSame('rewrite', $this->state->get('req')['routing_mode']);
        self::assertSame([], glob($this->root . '/storage/install-canary-*') ?: [], 'canary removed');

        self::assertSame('install.php?step=database', $this->post('requirements', [])->headers['Location']);

        $cfg = self::installDbConfig();
        $bad = $this->post('database', ['action' => 'test', 'pass' => 'x'] + $cfg + ['user' => 'nobody_' . bin2hex(random_bytes(2))]);
        self::assertSame(422, $bad->status);
        self::assertStringContainsString('Accès refusé', $bad->body);

        $ok = $this->post('database', ['action' => 'test', 'port' => (string) $cfg['port']] + $cfg);
        self::assertSame('install.php?step=site', $ok->headers['Location'] ?? null, $ok->body);

        $site = $this->post('site', [
            'site_name' => 'Ma table', 'base_url' => 'http://example.org', 'default_locale' => 'fr',
            'registration_mode' => 'open', 'default_quota_mb' => '500', 'max_upload_mb' => '10',
            'max_dimension_px' => '4096', 'storage' => 'default',
        ]);
        self::assertSame('install.php?step=admin', $site->headers['Location'] ?? null, $site->body);

        $weak = $this->post('admin', ['email' => 'a@b.fr', 'username' => 'Admin', 'password' => 'short', 'password_confirm' => 'short']);
        self::assertSame(422, $weak->status);

        $admin = $this->post('admin', [
            'email' => 'a@b.fr', 'username' => 'Admin', 'password' => self::PASSWORD, 'password_confirm' => self::PASSWORD,
        ]);
        self::assertSame('install.php?step=run', $admin->headers['Location']);
        self::assertStringNotContainsString(self::PASSWORD, json_encode($this->state->get('admin'), JSON_THROW_ON_ERROR));
    }

    public function testWithoutJavaScript(): void
    {
        $this->fillSteps1To4();
        self::assertStringContainsString('Nouvelle installation', $this->request('GET', ['step' => 'run'])->body);
        self::assertSame(303, $this->post('run', ['action' => 'start'])->status);

        $page = $this->request('GET', ['step' => 'run']);
        self::assertMatchesRegularExpression('#<head>.*<noscript><meta http-equiv="refresh" content="0;url=install.php\?step=run&amp;do=1&amp;k=[0-9a-f]{64}"></noscript>.*</head>#s', $page->body);
        self::assertStringContainsString('<script nonce="test-nonce">', $page->body);

        $get = ['step' => 'run', 'do' => '1', 'k' => $this->state->token()];
        self::assertSame(303, $this->request('GET', ['k' => 'forged'] + $get)->status, 'forged token');
        for ($i = 0; $i < 20; $i++) {
            $reply = $this->request('GET', $get);
            if ($reply->status === 303) {
                break;
            }
            self::assertStringContainsString('http-equiv="refresh"', $reply->body);
        }
        self::assertSame('install.php?step=done', $reply->headers['Location']);

        $done = $this->request('GET', ['step' => 'done']);
        self::assertStringContainsString('Installation terminée', $done->body);
        self::assertStringContainsString('href="http://example.org/login"', $done->body);
        self::assertFileExists($this->root . '/config.php');
        self::assertFileExists($this->root . '/storage/install.lock');

        // Afterwards: locked, even for the same browser.
        self::assertSame(403, $this->request('GET', ['step' => 'done'])->status);
        self::assertSame(403, $this->request('GET', [])->status);
    }

    public function testWithJavaScript(): void
    {
        $this->fillSteps1To4();
        $this->post('run', ['action' => 'start']);
        $get = ['step' => 'run', 'do' => '1', 'k' => $this->state->token(), 'format' => 'json'];
        $phases = [];
        for ($i = 0; $i < 20; $i++) {
            $reply = $this->request('GET', $get);
            self::assertSame('application/json; charset=utf-8', $reply->headers['Content-Type']);
            $data = json_decode($reply->body, true, 16, JSON_THROW_ON_ERROR);
            self::assertNull($data['error']);
            $phases[] = $data['phase'];
            if ($data['phase'] === 'done') {
                self::assertSame('install.php?step=done', $data['done_url']);
                break;
            }
        }
        // One "migrate" step per migration (0001, 0002, 0003) plus the last one that moves on.
        self::assertSame(['migrate', 'migrate', 'migrate', 'migrate', 'site', 'storage', 'config', 'lock', 'done'], $phases);
    }

    public function testExistingTablesNeedAnExplicitChoice(): void
    {
        $this->request('GET', []);
        $this->post('requirements', []);
        $this->db->pdo()->exec('CREATE TABLE ' . self::PREFIX . 'schema_migrations (version VARCHAR(10) PRIMARY KEY)');
        $cfg = self::installDbConfig();

        $page = $this->post('database', ['action' => 'test', 'port' => (string) $cfg['port']] + $cfg);
        self::assertSame(200, $page->status);
        self::assertStringContainsString('Des tables existent déjà', $page->body);
        self::assertNull($this->state->get('db'));

        $refused = $this->post('database', ['action' => 'choice', 'choice' => 'overwrite', 'confirm1' => '1', 'confirm2' => 'wrong']);
        self::assertSame(422, $refused->status);
        self::assertNull($this->state->get('db'));

        $this->post('database', ['action' => 'choice', 'choice' => 'overwrite', 'confirm1' => '1', 'confirm2' => self::PREFIX]);
        self::assertSame('overwrite', $this->state->get('db')['mode']);
        self::assertTrue($this->db->tableExists('schema_migrations'), 'nothing dropped before step 5');
    }
}
