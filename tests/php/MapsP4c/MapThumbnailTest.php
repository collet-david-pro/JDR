<?php

declare(strict_types=1);

namespace JDR\Tests\MapsP4c;

use JDR\Core\Response;
use JDR\Domain\Maps\MapHousekeeping;
use JDR\Domain\Maps\Transfer\MapThumbnailService;
use JDR\Tests\Api\ApiClient;

/**
 * PUT /maps/{id}/thumbnail and the signed thumbnail URL (contract P4c).
 */
final class MapThumbnailTest extends MapsP4cTestCase
{
    private function putThumb(ApiClient $client, string $mapId, string $bytes, string $type = 'image/png'): Response
    {
        return $this->rawRequest($client, 'PUT', '/maps/' . $mapId . '/thumbnail', $bytes, ['Content-Type' => $type]);
    }

    private static function png(int $width, int $height, bool $noise = false): string
    {
        $image = imagecreatetruecolor($width, $height);
        if ($noise) {
            for ($y = 0; $y < $height; $y++) {
                for ($x = 0; $x < $width; $x++) {
                    imagesetpixel($image, $x, $y, random_int(0, 0xffffff));
                }
            }
        }
        ob_start();
        imagepng($image, null, 0);

        return (string) ob_get_clean();
    }

    public function testThumbnailIsStoredAndServedThroughASignedUrl(): void
    {
        $s = $this->scene();
        $mapId = $s['map']['id'];
        $response = $this->putThumb($s['gm'], $mapId, (string) file_get_contents(self::fixture('valid_png_opaque.png')));
        self::assertSame(200, $response->status(), $response->body());
        $url = self::data($response)['thumb_url'];
        self::assertMatchesRegularExpression('#^/api/v1/map-thumbs/' . $mapId . '\?v=[0-9a-f]{24}&e=\d+&s=[A-Za-z0-9_-]+$#', $url);

        $file = $s['gm']->get(self::apiPath($url));
        self::assertSame(200, $file->status());
        self::assertSame('image/png', $file->header('Content-Type'));
        self::assertSame("default-src 'none'", $file->header('Content-Security-Policy'));
        self::assertSame([64, 48], array_slice((array) getimagesizefromstring($file->contents()), 0, 2));
        // Public route: no session needed, but the signature is.
        self::assertSame(200, $this->client('198.51.100.99')->get(self::apiPath($url))->status());
        self::assertSame(403, $s['gm']->get(self::apiPath(str_replace('&s=', '&s=x', $url)))->status());
        self::assertSame(403, $s['gm']->get('/map-thumbs/' . $mapId)->status());
        self::assertSame(304, $this->app->handle(\JDR\Core\Request::create('GET', $url, ['If-None-Match' => (string) $file->header('ETag')]))->status());

        // Map and MapSummary carry the URL.
        self::assertSame($url, self::data($s['gm']->get('/maps/' . $mapId))['thumb_url']);
        self::assertSame($url, self::data($s['gm']->get('/games/' . $s['game']['id'] . '/maps'))[0]['thumb_url']);

        // A new thumbnail replaces the file (WebP accepted).
        $files = self::storageFiles('map-thumbs');
        self::assertCount(1, $files);
        $webp = $this->putThumb($s['gm'], $mapId, (string) file_get_contents(self::fixture('valid_webp_lossy.webp')), 'image/webp');
        self::assertSame(200, $webp->status(), $webp->body());
        $newUrl = self::data($webp)['thumb_url'];
        self::assertNotSame($url, $newUrl);
        self::assertSame(404, $s['gm']->get(self::apiPath($url))->status(), 'the old URL is dead');
        self::assertSame('image/webp', $s['gm']->get(self::apiPath($newUrl))->header('Content-Type'));
        self::assertCount(1, self::storageFiles('map-thumbs'));
        self::assertNotSame($files, self::storageFiles('map-thumbs'));
        self::assertSame([], self::tmpLeftovers());
    }

    public function testMultipartBodyIsAccepted(): void
    {
        $s = $this->scene();
        $png = (string) file_get_contents(self::fixture('valid_png_transparent.png'));
        $body = "--b0und\r\nContent-Disposition: form-data; name=\"other\"\r\n\r\nx\r\n"
            . "--b0und\r\nContent-Disposition: form-data; name=\"file\"; filename=\"t.png\"\r\nContent-Type: image/png\r\n\r\n"
            . $png . "\r\n--b0und--\r\n";
        $response = $this->rawRequest($s['gm'], 'PUT', '/maps/' . $s['map']['id'] . '/thumbnail', $body, [
            'Content-Type' => 'multipart/form-data; boundary=b0und',
        ]);
        self::assertSame(200, $response->status(), $response->body());
        $served = $s['gm']->get(self::apiPath(self::data($response)['thumb_url']));
        self::assertSame([64, 64], array_slice((array) getimagesizefromstring($served->contents()), 0, 2));
    }

    public function testRefusedImages(): void
    {
        $s = $this->scene();
        $mapId = $s['map']['id'];
        foreach ([
            'jpeg' => [self::fixture('valid_jpeg_exif_orientation6.jpg'), 415, 'unsupported_type'],
            'gif' => [self::fixture('valid_gif_static.gif'), 415, 'unsupported_type'],
            'svg' => [self::fixture('trap_svg_renamed.png'), 415, 'unsupported_type'],
            'php polyglot' => [self::fixture('trap_polyglot_png_php.png'), 415, 'unsupported_type'],
            'animated webp' => [self::fixture('valid_webp_animated.webp'), 422, 'animation_too_long'],
            'truncated' => [self::fixture('trap_png_truncated.png'), 415, 'unsupported_type'],
        ] as $label => [$file, $status, $code]) {
            $response = $this->putThumb($s['gm'], $mapId, (string) file_get_contents($file));
            self::assertSame($status, $response->status(), $label . ' ' . $response->body());
            self::assertSame($code, self::errorCode($response), $label);
        }
        $tooWide = $this->putThumb($s['gm'], $mapId, self::png(513, 20));
        self::assertSame(422, $tooWide->status());
        self::assertSame('image_too_large', self::errorCode($tooWide));
        $tooHeavy = $this->putThumb($s['gm'], $mapId, self::png(500, 500, true));
        self::assertGreaterThan(MapThumbnailService::MAX_BYTES, strlen(self::png(500, 500, true)));
        self::assertSame(413, $tooHeavy->status());
        self::assertSame('file_too_large', self::errorCode($tooHeavy));
        $empty = $this->putThumb($s['gm'], $mapId, '');
        self::assertSame(422, $empty->status());

        self::assertNull(self::data($s['gm']->get('/maps/' . $mapId))['thumb_url']);
        self::assertSame([], self::storageFiles('map-thumbs'));
        self::assertSame([], self::tmpLeftovers());
    }

    public function testRightsAndDeletionWithTheMap(): void
    {
        $s = $this->scene();
        $mapId = $s['map']['id'];
        $png = (string) file_get_contents(self::fixture('valid_png_opaque.png'));
        $this->addMember($s['gm'], $s['game']['id'], 'Bob');
        $bob = $this->client('198.51.100.243');
        $bob->login('Bob', self::PASSWORD);
        $dave = $this->user('Dave');
        self::assertSame(403, $this->putThumb($bob, $mapId, $png)->status());
        self::assertSame(404, $this->putThumb($dave, $mapId, $png)->status());
        self::assertSame([], self::storageFiles('map-thumbs'));

        self::assertSame(200, $this->putThumb($s['gm'], $mapId, $png)->status());
        // The duplicate has no thumbnail of its own.
        $copy = self::data($s['gm']->post('/maps/' . $mapId . '/duplicate', []));
        self::assertNull($copy['thumb_url']);
        self::assertCount(1, self::storageFiles('map-thumbs'));

        // Trash then purge: the file goes with the map.
        self::assertSame(204, $s['gm']->delete('/maps/' . $mapId)->status());
        self::assertNotNull(self::data($s['gm']->get('/games/' . $s['game']['id'] . '/maps?state=trash'))[0]['thumb_url']);
        $this->ageDeletion('maps', $mapId, 40);
        self::assertSame(1, $this->app->container()->get(MapHousekeeping::class)->purgeTrash());
        self::assertSame([], self::storageFiles('map-thumbs'));
    }

    public function testOrphanFilesAreSwept(): void
    {
        $s = $this->scene();
        $png = (string) file_get_contents(self::fixture('valid_png_opaque.png'));
        self::assertSame(200, $this->putThumb($s['gm'], $s['map']['id'], $png)->status());
        $other = $this->newMap($s['gm'], $s['game']['id']);
        self::assertSame(200, $this->putThumb($s['gm'], $other['id'], $png)->status());
        self::assertCount(2, self::storageFiles('map-thumbs'));
        // The game is purged: its maps leave by cascade, their files stay until the sweep.
        $this->db->execute('DELETE FROM ' . $this->db->t('maps') . ' WHERE `id` = ?', [(int) $other['id']]);
        $service = $this->app->container()->get(MapThumbnailService::class);
        self::assertSame(0, $service->purgeOrphans(), 'too recent');
        foreach (self::storageFiles('map-thumbs') as $file) {
            touch(self::storage() . '/map-thumbs/' . $file, time() - 7200);
        }
        self::assertSame(1, $service->purgeOrphans());
        self::assertCount(1, self::storageFiles('map-thumbs'));
        self::assertNotNull(self::data($s['gm']->get('/maps/' . $s['map']['id']))['thumb_url']);
        self::assertSame(200, $s['gm']->get(self::apiPath((string) self::data($s['gm']->get('/maps/' . $s['map']['id']))['thumb_url']))->status());
    }
}
