<?php

declare(strict_types=1);

namespace JDR\Tests\Install;

use JDR\Install\ConfigWriter;
use JDR\Install\Env;
use JDR\Install\Guard;
use JDR\Install\Installer;
use JDR\Install\State;
use PHPUnit\Framework\TestCase;

final class GuardTest extends TestCase
{
    private string $root;

    protected function setUp(): void
    {
        $this->root = TempRoot::create();
    }

    protected function tearDown(): void
    {
        TempRoot::remove($this->root);
    }

    private function handle(State $state, string $method = 'GET', string $step = 'requirements'): \JDR\Install\Reply
    {
        $env = new Env($this->root, [
            'REQUEST_METHOD' => $method, 'HTTP_HOST' => 'example.org', 'SCRIPT_NAME' => '/install.php',
        ]);

        return (new Installer($env, $state, new FakeHttpClient(), 'nonce'))->handle(['step' => $step], []);
    }

    public function testNotInstalledOnAFreshRoot(): void
    {
        self::assertFalse(Guard::isInstalled($this->root));
    }

    public function testRefusesWhenConfigExists(): void
    {
        file_put_contents($this->root . '/config.php', "<?php\nreturn ['app_secret' => 'x'];\n");
        self::assertTrue(Guard::isInstalled($this->root));

        foreach (['requirements', 'database', 'run', 'done'] as $step) {
            $reply = $this->handle(State::memory(), 'GET', $step);
            self::assertSame(403, $reply->status, $step);
            self::assertStringContainsString('déjà installé', $reply->body);
            self::assertStringContainsString('install.lock', $reply->body); // manual reinstall procedure
        }
        self::assertSame(403, $this->handle(State::memory(), 'POST', 'database')->status);
    }

    public function testRefusesWhenLockExists(): void
    {
        file_put_contents($this->root . '/storage/install.lock', '{}');
        self::assertTrue(Guard::isInstalled($this->root));
        self::assertSame(403, $this->handle(State::memory())->status);
    }

    public function testLockWinsEvenForTheInstallingBrowser(): void
    {
        file_put_contents($this->root . '/storage/install.lock', '{}');
        $state = State::memory(['run' => ['phase' => 'lock', 'app_secret' => 'abc']]);
        self::assertFalse(Guard::ownsInstallation($this->root, $state));
    }

    public function testTheInstallingBrowserMayFinishAfterWritingConfig(): void
    {
        $secret = str_repeat('a', 128);
        file_put_contents($this->root . '/config.php', "<?php\nreturn ['app_secret' => '" . $secret . "'];\n");

        self::assertTrue(Guard::ownsInstallation($this->root, State::memory(['run' => ['phase' => 'lock', 'app_secret' => $secret]])));
        self::assertFalse(Guard::ownsInstallation($this->root, State::memory(['run' => ['phase' => 'lock', 'app_secret' => 'other']])));
        self::assertFalse(Guard::ownsInstallation($this->root, State::memory(['run' => ['phase' => 'migrate', 'app_secret' => $secret]])));
        self::assertFalse(Guard::ownsInstallation($this->root, State::memory()));
        self::assertNotNull(ConfigWriter::read($this->root . '/config.php'));
    }

    public function testFreshRootShowsRequirementsWithSecurityFriendlyMarkup(): void
    {
        $reply = $this->handle(State::memory());
        self::assertSame(200, $reply->status);
        self::assertStringContainsString('Vérification du serveur', $reply->body);
        self::assertStringNotContainsString('<script src', $reply->body);
        self::assertStringNotContainsString('<link', $reply->body);
    }

    public function testLaterStepsRedirectToTheFirstIncompleteOne(): void
    {
        $reply = $this->handle(State::memory(), 'GET', 'admin');
        self::assertSame(303, $reply->status);
        self::assertSame('install.php?step=requirements', $reply->headers['Location']);
    }

    public function testPostWithoutTokenIsRejected(): void
    {
        $state = State::memory(['req' => ['ok' => true, 'routing_mode' => 'rewrite']]);
        $reply = $this->handle($state, 'POST', 'database');
        self::assertSame(303, $reply->status);
        self::assertSame('err.token', $state->get('flash'));
        self::assertNull($state->get('db'));
    }
}
