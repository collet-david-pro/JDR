<?php

declare(strict_types=1);

namespace JDR\Tests\Assets;

use JDR\Domain\Assets\AssetIntegrity;

/**
 * POST /assets (projet.md 11.3, acceptance criteria P2): accepted formats, trapped corpus refused,
 * duplicates, atomic quota, real size of the files = storage_used_bytes.
 */
final class UploadApiTest extends AssetsTestCase
{
    /**
     * @return array<string, array{0: string, 1: string, 2: int, 3: int, 4: bool, 5: int}>
     */
    public static function validFixtures(): array
    {
        return [
            'png opaque' => ['valid_png_opaque.png', 'image/png', 64, 48, false, 1],
            'png transparent' => ['valid_png_transparent.png', 'image/png', 64, 64, false, 1],
            'png text chunks' => ['valid_png_text_chunk.png', 'image/png', 64, 48, false, 1],
            'jpeg exif orientation' => ['valid_jpeg_exif_orientation6.jpg', 'image/jpeg', 40, 80, false, 1],
            'webp lossy' => ['valid_webp_lossy.webp', 'image/webp', 64, 48, false, 1],
            'webp lossless' => ['valid_webp_lossless.webp', 'image/webp', 48, 48, false, 1],
            'gif animated' => ['valid_gif_animated.gif', 'image/gif', 32, 32, true, 10],
            'gif static' => ['valid_gif_static.gif', 'image/gif', 24, 24, false, 1],
            'webp animated' => ['valid_webp_animated.webp', 'image/webp', 48, 32, true, 3],
            'apng as still' => ['valid_apng.png', 'image/png', 32, 32, false, 1],
        ];
    }

    /**
     * @dataProvider validFixtures
     */
    public function testAcceptedFormats(string $fixture, string $mime, int $width, int $height, bool $animated, int $frames): void
    {
        $client = $this->userClient('Alice');
        $asset = $this->uploadOk($client, $fixture, ['kind' => 'token', 'name' => 'Héros']);

        self::assertSame($mime, $asset['mime']);
        self::assertSame([$width, $height], [$asset['width'], $asset['height']]);
        self::assertSame($animated, $asset['is_animated']);
        self::assertSame($frames, $asset['frame_count']);
        self::assertSame('Héros', $asset['name']);
        self::assertSame('token', $asset['kind']);
        self::assertSame('personal', $asset['scope']);
        self::assertSame((string) $this->userId('Alice'), $asset['owner_id']);
        self::assertIsString($asset['id']);
        self::assertSame('upload', $asset['source']);
        self::assertFalse($asset['favorite']);
        self::assertSame([], $asset['tags']);
        self::assertMatchesRegularExpression('#^/api/v1/files/[0-9a-f-]{36}\?t=full&e=\d+&s=[A-Za-z0-9_-]+$#', $asset['urls']['full']);
        self::assertStringContainsString('t=thumb', $asset['urls']['thumb']);
        self::assertSame([], self::tmpLeftovers());
        self::assertTrue($this->integrity()['ok'], json_encode($this->integrity()) ?: '');
        self::assertGreaterThan(0, $this->usedBytes('Alice'));
    }

    /**
     * @return array<string, array{0: string, 1: int, 2: string}>
     */
    public static function trappedFixtures(): array
    {
        $out = [];
        $dir = dirname(__DIR__, 2) . '/fixtures/uploads';
        $codes = [
            'trap_png_bomb_50000.png' => 'image_too_large',
            'trap_png_huge_20000.png' => 'image_too_large',
            'trap_gif_1000_frames.gif' => 'animation_too_long',
            'trap_gif_25s.gif' => 'animation_too_long',
        ];
        foreach (glob($dir . '/trap_*') ?: [] as $path) {
            $name = basename($path);
            $code = $codes[$name] ?? 'unsupported_type';
            $out[$name] = [$name, $code === 'unsupported_type' ? 415 : 422, $code];
        }

        return $out;
    }

    /**
     * @dataProvider trappedFixtures
     */
    public function testTrappedCorpusIsRefused(string $fixture, int $status, string $code): void
    {
        $client = $this->userClient('Alice');
        $response = $client->upload('/assets', self::fixture($fixture), ['kind' => 'object']);

        self::assertSame($status, $response->status(), $response->body());
        self::assertSame($code, self::errorCode($response));
        self::assertSame(0, $this->rows('assets'));
        self::assertSame(0, $this->usedBytes('Alice'));
        self::assertSame([], self::tmpLeftovers());
        self::assertSame([], $this->integrity()['orphan_files']);
        // Only the stable code and the generic message reach the client.
        self::assertStringNotContainsString(self::storage(), $response->body());
    }

    public function testTrappedCorpusIsComplete(): void
    {
        self::assertGreaterThanOrEqual(21, count(self::trappedFixtures()));
    }

    public function testDuplicateIsReturnedAndNotCountedTwice(): void
    {
        $client = $this->userClient('Alice');
        $first = $this->uploadOk($client, 'valid_png_opaque.png');
        $used = $this->usedBytes('Alice');

        $again = $client->upload('/assets', self::fixture('valid_png_opaque.png'), ['kind' => 'tile', 'name' => 'Autre nom']);
        self::assertSame(200, $again->status(), $again->body());
        self::assertTrue($again->payload()['meta']['duplicate']);
        self::assertSame($first['id'], $again->payload()['data']['id']);
        self::assertSame($used, $this->usedBytes('Alice'));
        self::assertSame(1, $this->rows('assets'));
        self::assertSame([], self::tmpLeftovers());

        // Another user uploading the same image gets their own asset.
        $bob = $this->userClient('Bob', 'user', '203.0.113.11');
        $own = $this->uploadOk($bob, 'valid_png_opaque.png');
        self::assertNotSame($first['id'], $own['id']);
        self::assertSame($used, $this->usedBytes('Bob'));
    }

    public function testQuotaExceededIsRefusedAtomically(): void
    {
        $client = $this->userClient('Alice');
        $first = $this->uploadOk($client, 'valid_png_opaque.png');
        $used = $this->usedBytes('Alice');
        $this->db->execute('UPDATE ' . $this->db->t('users') . ' SET `storage_quota_bytes` = ? WHERE `username` = ?', [$used + 10, 'Alice']);

        $response = $client->upload('/assets', self::fixture('valid_png_transparent.png'), ['kind' => 'object']);
        self::assertSame(413, $response->status(), $response->body());
        self::assertSame('quota_exceeded', self::errorCode($response));
        self::assertSame($used, $this->usedBytes('Alice'));
        self::assertSame(1, $this->rows('assets'));
        self::assertSame([], self::tmpLeftovers());
        self::assertTrue($this->integrity()['ok']);

        // A duplicate consumes nothing: still accepted when the quota is full.
        $dup = $client->upload('/assets', self::fixture('valid_png_opaque.png'), ['kind' => 'object']);
        self::assertSame(200, $dup->status());
        self::assertSame($first['id'], $dup->payload()['data']['id']);

        // Default quota of the settings applies when the user has none.
        $this->db->execute('UPDATE ' . $this->db->t('users') . ' SET `storage_quota_bytes` = NULL WHERE `username` = ?', ['Alice']);
        $this->changeSetting('default_quota_bytes', $used + 10);
        self::assertSame('quota_exceeded', self::errorCode($client->upload('/assets', self::fixture('valid_gif_static.gif'), ['kind' => 'object'])));
    }

    public function testRealFileSizesEqualStorageUsedBytes(): void
    {
        $client = $this->userClient('Alice');
        $ids = [];
        foreach (['valid_png_opaque.png', 'valid_gif_animated.gif', 'valid_webp_lossy.webp', 'valid_jpeg_exif_orientation6.jpg'] as $fixture) {
            $ids[] = $this->uploadOk($client, $fixture)['id'];
        }
        $this->uploadOk($client, 'valid_png_opaque.png', [], 200);
        $integrity = $this->app->container()->get(AssetIntegrity::class);
        self::assertSame($this->usedBytes('Alice'), $integrity->actualBytes($this->userId('Alice')));
        self::assertTrue($integrity->check()['ok']);

        $storage = $client->get('/me/storage');
        self::assertSame($this->usedBytes('Alice'), $storage->payload()['data']['used_bytes']);

        // Soft delete gives the bytes back at once (files stay until the trash purge).
        self::assertSame(204, $client->delete('/assets/' . $ids[1])->status());
        self::assertSame($this->usedBytes('Alice'), $integrity->actualBytes($this->userId('Alice')));
        self::assertTrue($integrity->check()['ok']);
    }

    public function testIntegrityReportsMismatches(): void
    {
        $client = $this->userClient('Alice');
        $asset = $this->uploadOk($client, 'valid_png_opaque.png');
        file_put_contents(self::storage() . '/assets/orphan.png', 'x');
        $this->db->execute('UPDATE ' . $this->db->t('users') . ' SET `storage_used_bytes` = 1 WHERE `username` = ?', ['Alice']);
        $uuid = (string) $this->db->fetchValue('SELECT `uuid` FROM ' . $this->db->t('assets') . ' WHERE `id` = ?', [(int) $asset['id']]);
        unlink(self::storage() . '/assets/' . substr($uuid, 0, 2) . '/' . substr($uuid, 2, 2) . '/' . $uuid . '.png');

        $report = $this->integrity();
        self::assertFalse($report['ok']);
        self::assertSame(['assets/orphan.png'], $report['orphan_files']);
        self::assertSame([$uuid], $report['missing_files']);
        self::assertSame(1, $report['quota'][0]['recorded_bytes']);
    }

    public function testRequestTooLargeIsRefusedWithoutProcessing(): void
    {
        $client = $this->userClient('Alice');
        $response = $client->upload('/assets', self::fixture('valid_png_opaque.png'), ['kind' => 'object'], null, ['Content-Length' => '999999999']);
        self::assertSame(413, $response->status());
        self::assertSame('file_too_large', self::errorCode($response));

        $this->changeSetting('max_upload_bytes', 100);
        $small = $client->upload('/assets', self::fixture('valid_png_opaque.png'), ['kind' => 'object']);
        self::assertSame(413, $small->status());
        self::assertSame('file_too_large', self::errorCode($small));

        $ini = $client->upload('/assets', self::fixture('valid_png_opaque.png'), ['kind' => 'object'], null, [], UPLOAD_ERR_INI_SIZE);
        self::assertSame('file_too_large', self::errorCode($ini));
        self::assertSame(0, $this->rows('assets'));
        self::assertSame([], self::tmpLeftovers());
    }

    public function testValidation(): void
    {
        $client = $this->userClient('Alice');
        $noKind = $client->upload('/assets', self::fixture('valid_png_opaque.png'), []);
        self::assertSame(['kind' => 'required'], $noKind->payload()['error']['fields']);
        $badKind = $client->upload('/assets', self::fixture('valid_png_opaque.png'), ['kind' => 'dragon']);
        self::assertSame(['kind' => 'invalid'], $badKind->payload()['error']['fields']);
        $noFile = $client->upload('/assets', self::fixture('valid_png_opaque.png'), ['kind' => 'tile'], null, [], UPLOAD_ERR_NO_FILE);
        self::assertSame(['file' => 'required'], $noFile->payload()['error']['fields']);
        $badCategory = $client->upload('/assets', self::fixture('valid_png_opaque.png'), ['kind' => 'tile', 'category_id' => '999']);
        self::assertSame(['category_id' => 'invalid'], $badCategory->payload()['error']['fields']);
        self::assertSame(0, $this->rows('assets'));
    }

    public function testNameDefaultsToTheFileName(): void
    {
        $client = $this->userClient('Alice');
        $response = $client->upload('/assets', self::fixture('valid_png_opaque.png'), ['kind' => 'tile'], '../../Mur_de pierre.PNG');
        self::assertSame(201, $response->status());
        self::assertSame('Mur de pierre', $response->payload()['data']['name']);
    }

    public function testGeneralAssetsAreForAdminsAndConsumeNoQuota(): void
    {
        $user = $this->userClient('Alice');
        $refused = $user->upload('/assets', self::fixture('valid_png_opaque.png'), ['kind' => 'tile', 'scope' => 'general']);
        self::assertSame(403, $refused->status());

        $admin = $this->userClient('Admin', 'admin', '203.0.113.20');
        $asset = $this->uploadOk($admin, 'valid_png_opaque.png', ['scope' => 'general']);
        self::assertSame('general', $asset['scope']);
        self::assertNull($asset['owner_id']);
        self::assertSame(0, $this->usedBytes('Admin'));
        $dup = $admin->upload('/assets', self::fixture('valid_png_opaque.png'), ['kind' => 'tile', 'scope' => 'general']);
        self::assertSame(200, $dup->status());
        self::assertTrue($this->integrity()['ok']);
    }

    public function testClientOpIdReplaysTheSameAnswer(): void
    {
        $client = $this->userClient('Alice');
        $first = $this->uploadOk($client, 'valid_png_opaque.png', ['client_op_id' => 'op-123']);
        $replay = $client->upload('/assets', self::fixture('valid_gif_static.gif'), ['kind' => 'object', 'client_op_id' => 'op-123']);
        self::assertSame(201, $replay->status());
        self::assertSame($first['id'], $replay->payload()['data']['id']);
        self::assertSame(1, $this->rows('assets'));
    }

    public function testUploadRateLimit(): void
    {
        $client = $this->userClient('Alice');
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('rate_limits') . ' (`bucket`, `hits`, `window_start`) VALUES (?, 60, UTC_TIMESTAMP())',
            ['upload:u' . $this->userId('Alice')],
        );
        $response = $client->upload('/assets', self::fixture('valid_png_opaque.png'), ['kind' => 'object']);
        self::assertSame(429, $response->status());
        self::assertSame('rate_limited', self::errorCode($response));
        self::assertNotNull($response->header('Retry-After'));
    }

    public function testLimits(): void
    {
        $client = $this->userClient('Alice');
        $data = self::data($client->get('/assets/limits'));
        self::assertSame(['image/png', 'image/jpeg', 'image/webp', 'image/gif'], $data['accepted_mimes']);
        self::assertSame(4096, $data['max_dimension_px']);
        self::assertSame(16777216, $data['max_total_pixels']);
        self::assertSame(300, $data['max_frames']);
        self::assertSame(20000, $data['max_animation_ms']);
        self::assertLessThanOrEqual(10485760, $data['max_upload_bytes']);
        self::assertGreaterThan(0, $data['max_upload_bytes']);
    }
}
