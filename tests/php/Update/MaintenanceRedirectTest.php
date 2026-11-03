<?php

declare(strict_types=1);

namespace JDR\Tests\Update;

use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Tests\Api\ApiClient;
use JDR\Tests\Api\ApiTestCase;

/**
 * Database behind the code: an administrator is sent to update.php (302 for a page, update_url in the 503 body of
 * the API); everybody else keeps the plain 503.
 */
final class MaintenanceRedirectTest extends ApiTestCase
{
    private function behind(ApiClient ...$clients): void
    {
        $this->setSetting('db_version', '0001');
        $this->app = $this->makeApp(); // SystemStatus reads the settings once per application
        foreach ($clients as $client) {
            $client->withApp($this->app);
        }
    }

    private function page(?ApiClient $client = null): Response
    {
        return $this->app->handle(Request::create('GET', '/', ['User-Agent' => 'PHPUnit browser'], '', '', ['REMOTE_ADDR' => '203.0.113.10'], $client->cookies ?? []));
    }

    public function testAnAdministratorOpeningAPageIsRedirectedToTheUpdate(): void
    {
        $this->createUser('Keeper', 'admin');
        $client = $this->client();
        $client->login('Keeper', self::PASSWORD);
        $this->behind($client);

        $page = $this->page($client);
        self::assertSame(302, $page->status());
        self::assertSame('/update.php', $page->header('Location'));
    }

    public function testOthersKeepThePlain503Page(): void
    {
        $this->createUser('Keeper', 'admin');
        $this->createUser('Alice', 'user');
        $alice = $this->client();
        $alice->login('Alice', self::PASSWORD);
        $this->behind($alice);

        self::assertSame(503, $this->page()->status()); // anonymous
        self::assertSame(503, $this->page($alice)->status());
    }

    public function testTheApi503CarriesTheUpdateUrlForAnAdministratorOnly(): void
    {
        $this->createUser('Keeper', 'admin');
        $this->createUser('Alice', 'user');
        $admin = $this->client();
        $admin->login('Keeper', self::PASSWORD);
        $anonymous = $this->client();
        $this->behind($admin, $anonymous);

        $response = $admin->get('/admin/update');
        self::assertSame(503, $response->status());
        self::assertSame('/update.php', $response->payload()['error']['fields']['update_url'] ?? null);

        $anonymous = $anonymous->get('/admin/update');
        self::assertSame(503, $anonymous->status());
        self::assertArrayNotHasKey('update_url', (array) ($anonymous->payload()['error']['fields'] ?? []));
    }
}
