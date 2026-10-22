<?php

declare(strict_types=1);

namespace JDR\Tests\MapsP4c;

use JDR\Core\App;
use JDR\Core\Clock;
use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Tests\Api\ApiClient;
use JDR\Tests\Maps\MapsTestCase;
use JDR\Zip\ZipWriter;

/**
 * API tests of the P4c map features: versions, export / import, thumbnails.
 */
abstract class MapsP4cTestCase extends MapsTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        foreach (['map-thumbs', 'scratch'] as $dir) {
            self::emptyDir(self::storage() . '/' . $dir);
        }
    }

    protected static function mapFixture(string $name): string
    {
        $path = self::projectRoot() . '/tests/fixtures/maps/' . $name;
        self::assertFileExists($path);

        return $path;
    }

    /**
     * @return array<string, mixed>
     */
    protected static function fixtureDoc(string $name = 'v1-sample.json'): array
    {
        return json_decode((string) file_get_contents(self::mapFixture($name)), true, 512, JSON_THROW_ON_ERROR);
    }

    /**
     * Writes $content to a new file of the scratch directory of the test.
     */
    protected static function scratchFile(string $content, string $suffix = '.json'): string
    {
        $dir = self::storage() . '/scratch';
        if (!is_dir($dir)) {
            mkdir($dir, 0777, true);
        }
        $path = $dir . '/' . bin2hex(random_bytes(6)) . $suffix;
        file_put_contents($path, $content);

        return $path;
    }

    /**
     * ZIP {map.json, assets/<sha>.<ext> => source file}.
     *
     * @param array<string, string> $assets archive name => source path
     */
    protected static function zipFile(string $json, array $assets = []): string
    {
        $path = self::scratchFile('', '.zip');
        $writer = ZipWriter::create($path);
        $writer->addString('map.json', $json);
        foreach ($assets as $name => $source) {
            $writer->addFile($name, $source);
        }
        $writer->finish();
        $writer->close();

        return $path;
    }

    /**
     * POST /games/{id}/maps/import with a file.
     *
     * @param array<string, string> $fields
     */
    protected function import(ApiClient $client, string $gameId, string $file, array $fields = []): Response
    {
        return $client->upload('/games/' . $gameId . '/maps/import', $file, $fields, basename($file));
    }

    /**
     * @return array{map: array<string, mixed>, missing_assets: list<array<string, string>>}
     */
    protected function importOk(ApiClient $client, string $gameId, string $file, array $fields = []): array
    {
        $response = $this->import($client, $gameId, $file, $fields);
        self::assertSame(201, $response->status(), $response->body());

        return self::data($response);
    }

    /**
     * GET /maps/{id}/export (JSON) decoded.
     *
     * @return array<string, mixed>
     */
    protected function exportDoc(ApiClient $client, string $mapId): array
    {
        $response = $client->get('/maps/' . $mapId . '/export');
        self::assertSame(200, $response->status(), $response->body());
        self::assertSame('application/json; charset=utf-8', $response->header('Content-Type'));

        return json_decode($response->body(), true, 512, JSON_THROW_ON_ERROR);
    }

    /**
     * Request with a raw body, sent with the cookies and CSRF token of $client.
     *
     * @param array<string, string> $headers
     */
    protected function rawRequest(ApiClient $client, string $method, string $path, string $body, array $headers = []): Response
    {
        $headers += ['User-Agent' => 'PHPUnit browser', 'Content-Length' => (string) strlen($body)];
        if ($client->csrf !== null) {
            $headers += ['X-CSRF-Token' => $client->csrf];
        }

        return $this->app->handle(Request::create($method, '/api/v1' . $path, $headers, $body, '', ['REMOTE_ADDR' => $client->ip], $client->cookies));
    }

    /**
     * Rebuilds the app with a frozen clock and points the clients at it.
     */
    protected function freezeAt(int $timestamp, ApiClient ...$clients): void
    {
        $this->app = $this->makeApp(new Clock(new \DateTimeImmutable('@' . $timestamp)));
        foreach ($clients as $client) {
            $client->withApp($this->app);
        }
    }

    /**
     * Decoded cells of the chunks of a document: "floor|layer|x,y" => [index, variant, flags].
     *
     * @param array<string, mixed> $doc
     * @return array<string, array{0: int, 1: int, 2: int}>
     */
    protected static function docCells(array $doc): array
    {
        $cells = [];
        foreach ($doc['chunks'] as $floor => $layers) {
            foreach ($layers as $layer => $blocks) {
                foreach ($blocks as $key => $b64) {
                    [$cx, $cy] = array_map('intval', explode(':', (string) $key));
                    $raw = \JDR\Maps\ChunkCodec::decode((string) base64_decode((string) $b64, true), (string) $layer, 0x10000);
                    for ($y = 0; $y < 32; $y++) {
                        for ($x = 0; $x < 32; $x++) {
                            $cell = \JDR\Maps\ChunkCodec::cellAt($raw, \JDR\Maps\ChunkCodec::offset($x, $y));
                            if ($cell[0] !== 0) {
                                $cells[$floor . '|' . $layer . '|' . ($cx * 32 + $x) . ',' . ($cy * 32 + $y)] = $cell;
                            }
                        }
                    }
                }
            }
        }
        ksort($cells);

        return $cells;
    }

    protected function app(): App
    {
        return $this->app;
    }

    /**
     * Files below storage/<dir> (relative paths).
     *
     * @return list<string>
     */
    protected static function storageFiles(string $dir): array
    {
        $base = self::storage() . '/' . $dir;
        if (!is_dir($base)) {
            return [];
        }
        $out = [];
        $items = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($base, \FilesystemIterator::SKIP_DOTS));
        foreach ($items as $item) {
            if ($item->isFile()) {
                $out[] = substr($item->getPathname(), strlen($base) + 1);
            }
        }
        sort($out);

        return $out;
    }
}
