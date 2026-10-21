<?php

declare(strict_types=1);

namespace JDR\Tests\Assets;

use JDR\Core\Clock;
use JDR\Core\Signer;

/**
 * GET /files/{uuid} (projet.md 9.3): signed URLs, ETag / 304, Range, headers.
 */
final class FilesApiTest extends AssetsTestCase
{
    public function testSignedUrlServesTheFileWithoutSession(): void
    {
        $alice = $this->userClient('Alice');
        $asset = $this->uploadOk($alice, 'valid_png_opaque.png', ['name' => 'Mur "ancien" / é']);
        $anonymous = $this->client('198.51.100.7');

        $response = $anonymous->get(self::apiPath($asset['urls']['full']));
        self::assertSame(200, $response->status());
        self::assertNotNull($response->file());
        self::assertSame('', $response->body());
        $content = $response->contents();
        self::assertSame($asset['size_bytes'], strlen($content));
        self::assertStringStartsWith("\x89PNG", $content);
        self::assertSame('image/png', $response->header('Content-Type'));
        self::assertSame((string) $asset['size_bytes'], $response->header('Content-Length'));
        self::assertSame('"' . hash('sha256', $content) . '"', $response->header('ETag'));
        self::assertSame('private, max-age=86400, immutable', $response->header('Cache-Control'));
        self::assertSame("default-src 'none'", $response->header('Content-Security-Policy'));
        self::assertSame('nosniff', $response->header('X-Content-Type-Options'));
        self::assertSame('bytes', $response->header('Accept-Ranges'));
        self::assertSame('inline; filename="Mur _ancien.png"', $response->header('Content-Disposition'));
        self::assertNull($response->header('Set-Cookie'));
        self::assertSame([], $anonymous->cookies);

        $thumb = $anonymous->get(self::apiPath($asset['urls']['thumb']));
        self::assertSame(200, $thumb->status());
        self::assertContains($thumb->header('Content-Type'), ['image/webp', 'image/png']);
        self::assertNotSame($response->header('ETag'), $thumb->header('ETag'));
    }

    public function testTamperedOrExpiredUrlsAreForbidden(): void
    {
        $alice = $this->userClient('Alice');
        $asset = $this->uploadOk($alice, 'valid_png_opaque.png');
        $path = self::apiPath($asset['urls']['full']);
        parse_str((string) parse_url($path, PHP_URL_QUERY), $q);
        $uuid = $asset['uuid'];

        $cases = [
            'bad signature' => '/files/' . $uuid . '?t=full&e=' . $q['e'] . '&s=' . strrev((string) $q['s']),
            'other type' => '/files/' . $uuid . '?t=thumb&e=' . $q['e'] . '&s=' . $q['s'],
            'longer expiry' => '/files/' . $uuid . '?t=full&e=' . ((int) $q['e'] + 86400) . '&s=' . $q['s'],
            'no signature' => '/files/' . $uuid . '?t=full&e=' . $q['e'],
            'bad type' => '/files/' . $uuid . '?t=raw&e=' . $q['e'] . '&s=' . $q['s'],
            'other uuid' => '/files/' . str_replace(substr($uuid, 0, 1), substr($uuid, 0, 1) === 'a' ? 'b' : 'a', $uuid) . '?t=full&e=' . $q['e'] . '&s=' . $q['s'],
            'not a uuid' => '/files/abc?t=full&e=' . $q['e'] . '&s=' . $q['s'],
        ];
        foreach ($cases as $label => $url) {
            $response = $this->client()->get($url);
            self::assertSame(403, $response->status(), $label);
        }

        // Expired: same URL, two days later.
        $later = $this->makeApp(Clock::at(gmdate('Y-m-d H:i:s', (int) $q['e'] + 1)));
        self::assertSame(403, $this->client()->withApp($later)->get($path)->status());

        // A URL is stable for the whole day and expires at the end of the next one.
        self::assertSame(Signer::dailyExpiry(time()), (int) $q['e']);
    }

    public function testConditionalAndRangeRequests(): void
    {
        $alice = $this->userClient('Alice');
        $asset = $this->uploadOk($alice, 'valid_png_opaque.png');
        $path = self::apiPath($asset['urls']['full']);
        $client = $this->client();
        $full = $client->get($path);
        $etag = (string) $full->header('ETag');
        $content = $full->contents();
        $size = strlen($content);

        $notModified = $client->request('GET', $path, null, ['If-None-Match' => $etag]);
        self::assertSame(304, $notModified->status());
        self::assertNull($notModified->file());
        self::assertSame($etag, $notModified->header('ETag'));
        self::assertSame(304, $client->request('GET', $path, null, ['If-None-Match' => '"x", W/' . $etag])->status());
        self::assertSame(200, $client->request('GET', $path, null, ['If-None-Match' => '"other"'])->status());

        $partial = $client->request('GET', $path, null, ['Range' => 'bytes=0-9']);
        self::assertSame(206, $partial->status());
        self::assertSame(substr($content, 0, 10), $partial->contents());
        self::assertSame('bytes 0-9/' . $size, $partial->header('Content-Range'));
        self::assertSame('10', $partial->header('Content-Length'));

        $suffix = $client->request('GET', $path, null, ['Range' => 'bytes=-5']);
        self::assertSame(substr($content, -5), $suffix->contents());
        $open = $client->request('GET', $path, null, ['Range' => 'bytes=10-']);
        self::assertSame(substr($content, 10), $open->contents());

        $unsatisfiable = $client->request('GET', $path, null, ['Range' => 'bytes=' . $size . '-']);
        self::assertSame(416, $unsatisfiable->status());
        self::assertSame('bytes */' . $size, $unsatisfiable->header('Content-Range'));

        $multi = $client->request('GET', $path, null, ['Range' => 'bytes=0-1,4-5']);
        self::assertSame(200, $multi->status());
        $staleIfRange = $client->request('GET', $path, null, ['Range' => 'bytes=0-1', 'If-Range' => '"old"']);
        self::assertSame(200, $staleIfRange->status());
    }

    public function testDeletedAssetIsNotServed(): void
    {
        $alice = $this->userClient('Alice');
        $asset = $this->uploadOk($alice, 'valid_png_opaque.png');
        self::assertSame(204, $alice->delete('/assets/' . $asset['id'])->status());
        self::assertSame(404, $this->client()->get(self::apiPath($asset['urls']['full']))->status());
    }

    public function testQueryRoutingModeUrls(): void
    {
        $alice = $this->userClient('Alice');
        $asset = $this->uploadOk($alice, 'valid_png_opaque.png');
        $urls = $this->app->container()->get(\JDR\Domain\Assets\AssetUrls::class);
        $url = $urls->url('/jdr/index.php?r=/api/v1', $asset['uuid'], 'thumb');
        self::assertStringStartsWith('/jdr/index.php?r=/api/v1/files/' . $asset['uuid'] . '&t=thumb&e=', $url);
        $request = \JDR\Core\Request::create('GET', $url, [], '', '/jdr');
        self::assertSame('/api/v1/files/' . $asset['uuid'], $request->path);
        self::assertSame(200, $this->app->handle($request)->status());
    }

    public function testRangeParser(): void
    {
        $parse = [\JDR\Domain\Assets\FileServer::class, 'parseRange'];
        self::assertSame([0, 99], $parse('bytes=0-', 100));
        self::assertSame([90, 99], $parse('bytes=-10', 100));
        self::assertSame([0, 99], $parse('bytes=-1000', 100));
        self::assertSame([5, 99], $parse('bytes=5-500', 100));
        self::assertFalse($parse('bytes=100-', 100));
        self::assertFalse($parse('bytes=9-5', 100));
        self::assertFalse($parse('bytes=-0', 100));
        self::assertNull($parse('items=0-1', 100));
        self::assertNull($parse('bytes=-', 100));
    }
}
