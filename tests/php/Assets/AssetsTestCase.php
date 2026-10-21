<?php

declare(strict_types=1);

namespace JDR\Tests\Assets;

use JDR\Core\Response;
use JDR\Domain\Assets\AssetIntegrity;
use JDR\Domain\Settings\Settings;
use JDR\Tests\Api\ApiClient;
use JDR\Tests\Api\ApiTestCase;

/**
 * API tests of the asset domain: real image pipeline (lot A) and the fixtures of
 * tests/fixtures/uploads; storage in the temporary root of ApiTestCase, emptied before each test.
 */
abstract class AssetsTestCase extends ApiTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        foreach (['assets', 'jobs', 'tmp'] as $dir) {
            self::emptyDir(self::storage() . '/' . $dir);
        }
    }

    /**
     * Writes a setting and forgets the per-request cache of Settings (a new request in production).
     */
    protected function changeSetting(string $key, mixed $value): void
    {
        $this->setSetting($key, $value);
        $this->app->container()->get(Settings::class)->refresh();
    }

    protected static function storage(): string
    {
        return self::$root . '/storage';
    }

    protected static function fixture(string $name): string
    {
        $path = self::projectRoot() . '/tests/fixtures/uploads/' . $name;
        self::assertFileExists($path);

        return $path;
    }

    /**
     * Logged-in client of a new user.
     */
    protected function userClient(string $username, string $role = 'user', string $ip = '203.0.113.10'): ApiClient
    {
        $this->createUser($username, $role);
        $client = $this->client($ip);
        $client->login($username, self::PASSWORD);

        return $client;
    }

    protected function userId(string $username): int
    {
        return (int) $this->db->fetchValue('SELECT `id` FROM ' . $this->db->t('users') . ' WHERE `username` = ?', [$username]);
    }

    protected function usedBytes(string $username): int
    {
        return (int) $this->db->fetchValue('SELECT `storage_used_bytes` FROM ' . $this->db->t('users') . ' WHERE `username` = ?', [$username]);
    }

    /**
     * Uploads a fixture and asserts the status; returns the Asset.
     *
     * @param array<string, string> $fields
     * @return array<string, mixed>
     */
    protected function uploadOk(ApiClient $client, string $fixture, array $fields = [], int $status = 201): array
    {
        $response = $client->upload('/assets', self::fixture($fixture), $fields + ['kind' => 'object']);
        self::assertSame($status, $response->status(), $fixture . ': ' . $response->body());

        return $response->payload()['data'];
    }

    /**
     * Path relative to /api/v1 of a signed URL returned by the API.
     */
    protected static function apiPath(string $url): string
    {
        self::assertStringStartsWith('/api/v1/', $url);

        return substr($url, strlen('/api/v1'));
    }

    protected function integrity(): array
    {
        return $this->app->container()->get(AssetIntegrity::class)->check();
    }

    /**
     * @return list<string> files left in storage/tmp
     */
    protected static function tmpLeftovers(): array
    {
        $dir = self::storage() . '/tmp';

        return array_values(array_diff(is_dir($dir) ? (scandir($dir) ?: []) : [], ['.', '..']));
    }

    protected static function data(Response $response): mixed
    {
        return $response->payload()['data'];
    }

    protected static function emptyDir(string $dir): void
    {
        if (!is_dir($dir)) {
            return;
        }
        $items = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::CHILD_FIRST,
        );
        foreach ($items as $item) {
            $item->isDir() ? @rmdir($item->getPathname()) : @unlink($item->getPathname());
        }
    }
}
