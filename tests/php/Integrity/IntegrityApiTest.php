<?php

declare(strict_types=1);

namespace JDR\Tests\Integrity;

use JDR\Domain\Integrity\IntegrityScanner;
use JDR\Tests\Api\ApiClient;
use JDR\Tests\Maps\MapsTestCase;

final class IntegrityApiTest extends MapsTestCase
{
    /**
     * @return array{issues: list<array<string, mixed>>, calls: int}
     */
    private function fullCheck(ApiClient $admin): array
    {
        $issues = [];
        $cursor = null;
        $calls = 0;
        do {
            $response = $admin->post('/admin/integrity/check', $cursor === null ? [] : ['cursor' => $cursor]);
            self::assertSame(200, $response->status(), $response->body());
            $data = self::data($response);
            array_push($issues, ...$data['issues']);
            $cursor = $data['cursor'];
            $calls++;
            self::assertLessThan(200, $calls);
        } while ($cursor !== null);
        usort($issues, static fn (array $a, array $b): int => $a['id'] <=> $b['id']);

        return ['issues' => $issues, 'calls' => $calls];
    }

    /**
     * @param list<array<string, mixed>> $issues
     * @return list<string>
     */
    private static function kinds(array $issues): array
    {
        return array_values(array_unique(array_column($issues, 'kind')));
    }

    /**
     * @return array<string, mixed> scene() + admin client
     */
    private function damagedScene(): array
    {
        $s = $this->scene();
        $this->opsOk($s['gm'], $s['map']['id'], [self::tiles($s['floor'], 'ground', [[0, 0, 1], [1, 0, 1], [2, 0, 2]])]);
        $s['admin'] = $this->user('Root', 'admin');

        return $s;
    }

    public function testRights(): void
    {
        self::assertSame(401, $this->client()->post('/admin/integrity/check', [])->status());
        self::assertSame(401, $this->client('203.0.113.77')->post('/admin/integrity/fix', ['issues' => []])->status());
        $user = $this->user('Bob');
        self::assertSame(403, $user->post('/admin/integrity/check', [])->status());
        self::assertSame(403, $user->post('/admin/integrity/fix', ['issues' => []])->status());
    }

    public function testHealthyBaseHasNoIssue(): void
    {
        $s = $this->damagedScene();
        $result = $this->fullCheck($s['admin']);
        self::assertSame([], $result['issues']);
        $data = self::data($s['admin']->post('/admin/integrity/check', []));
        self::assertNull($data['cursor']);
        self::assertSame($data['progress']['total'], $data['progress']['done']);
    }

    public function testSlicesGiveTheSameResultAsOneCall(): void
    {
        $s = $this->damagedScene();
        $this->db->execute('UPDATE ' . $this->db->t('map_asset_refs') . ' SET `ref_count` = 99');
        $this->db->execute('UPDATE ' . $this->db->t('users') . ' SET `storage_used_bytes` = 5 WHERE `username` = ?', ['Alice']);
        $whole = $this->fullCheck($s['admin']);
        self::assertSame(1, $whole['calls']);
        self::assertNotSame([], $whole['issues']);

        $this->app->container()->get(IntegrityScanner::class)->budget = 0.0;
        $sliced = $this->fullCheck($s['admin']);
        self::assertGreaterThan(3, $sliced['calls']);
        self::assertSame($whole['issues'], $sliced['issues']);
    }

    public function testEachKindIsDetectedFixedAndTheCheckGetsClean(): void
    {
        $s = $this->damagedScene();
        $admin = $s['admin'];
        $t = fn (string $table): string => $this->db->t($table);
        $mapId = (int) $s['map']['id'];
        $storage = self::storage();

        // quota
        $this->db->execute('UPDATE ' . $t('users') . ' SET `storage_used_bytes` = 7 WHERE `username` = ?', ['Alice']);
        // size mismatch (file of A grows) + missing file (file of B removed)
        $rowA = $this->db->fetchOne('SELECT * FROM ' . $t('assets') . ' WHERE `id` = ?', [(int) $s['a']['id']]);
        file_put_contents($storage . '/assets/' . substr($rowA['uuid'], 0, 2) . '/' . substr($rowA['uuid'], 2, 2) . '/' . $rowA['uuid'] . '.' . $rowA['ext'], 'xxxx', FILE_APPEND);
        $rowB = $this->db->fetchOne('SELECT * FROM ' . $t('assets') . ' WHERE `id` = ?', [(int) $s['b']['id']]);
        unlink($storage . '/assets/' . substr($rowB['uuid'], 0, 2) . '/' . substr($rowB['uuid'], 2, 2) . '/' . $rowB['uuid'] . '.' . $rowB['ext']);
        // orphan file
        mkdir($storage . '/assets/zz/zz', 0777, true);
        file_put_contents($storage . '/assets/zz/zz/stray.bin', 'abc');
        // refs, chunk, fog, revision
        $this->db->execute('UPDATE ' . $t('map_asset_refs') . ' SET `ref_count` = 99 WHERE `map_id` = ? AND `asset_id` = ?', [$mapId, (int) $s['a']['id']]);
        $this->db->execute('UPDATE ' . $t('map_chunks') . " SET `data` = 'junk' WHERE `map_id` = ? AND `cx` = 0 AND `layer` = 'ground'", [$mapId]);
        $this->db->execute(
            'INSERT INTO ' . $t('map_fog') . ' (`map_id`, `floor_id`, `cx`, `cy`, `data`, `updated_at`) VALUES (?, ?, 0, 0, ?, NOW())',
            [$mapId, (int) $s['floor'], 'junk'],
        );
        $this->db->execute('UPDATE ' . $t('maps') . ' SET `revision` = 0 WHERE `id` = ?', [$mapId]);

        $first = $this->fullCheck($admin);
        foreach (['quota_mismatch', 'size_mismatch', 'missing_file', 'orphan_file', 'asset_refs_mismatch', 'undecodable_chunk', 'undecodable_fog', 'revision_ahead'] as $kind) {
            self::assertContains($kind, self::kinds($first['issues']), $kind);
        }
        $orphan = array_values(array_filter($first['issues'], static fn (array $i): bool => $i['kind'] === 'orphan_file'))[0];
        self::assertSame('assets/zz/zz/stray.bin', $orphan['subject']['path']);
        self::assertSame(['action' => 'delete_file', 'destructive' => true], $orphan['fix']);
        self::assertSame(['action' => 'recalc_quota', 'destructive' => false], array_values(array_filter($first['issues'], static fn (array $i): bool => $i['kind'] === 'quota_mismatch'))[0]['fix']);

        // Destructive without confirmation: refused, nothing done.
        $destructive = array_values(array_filter($first['issues'], static fn (array $i): bool => $i['fix'] !== null && $i['fix']['destructive']));
        $response = $admin->post('/admin/integrity/fix', ['issues' => $destructive]);
        self::assertSame(422, $response->status());
        self::assertSame('integrity.confirm_required', self::errorCode($response));
        self::assertFileExists($storage . '/assets/zz/zz/stray.bin');
        self::assertSame(1, $this->rows('map_fog'));

        $audit = $this->rows('audit_log', "`action` = 'integrity.fix'");
        for ($round = 0, $issues = $first['issues']; $round < 5 && $issues !== []; $round++) {
            $fixable = array_values(array_filter($issues, static fn (array $i): bool => $i['fix'] !== null));
            $response = $admin->post('/admin/integrity/fix', ['issues' => $fixable, 'confirm' => true]);
            self::assertSame(200, $response->status(), $response->body());
            $issues = $this->fullCheck($admin)['issues'];
        }
        self::assertSame([], $issues);
        self::assertGreaterThan($audit, $this->rows('audit_log', "`action` = 'integrity.fix'"));
        self::assertFileDoesNotExist($storage . '/assets/zz/zz/stray.bin');
        self::assertSame(0, $this->rows('map_fog'));
        self::assertSame(0, $this->rows('assets', '`id` = ' . (int) $s['b']['id']));

        // Fixing again does nothing.
        $again = self::data($admin->post('/admin/integrity/fix', ['issues' => [$orphan], 'confirm' => true]));
        self::assertSame([], $again['fixed']);
        self::assertSame('already_fixed', $again['skipped'][0]['reason']);
    }

    public function testRefToDeletedAssetHasNoAutomaticFix(): void
    {
        $s = $this->damagedScene();
        $this->db->execute('UPDATE ' . $this->db->t('assets') . ' SET `deleted_at` = NOW() WHERE `id` = ?', [(int) $s['a']['id']]);
        $issues = $this->fullCheck($s['admin'])['issues'];
        $ref = array_values(array_filter($issues, static fn (array $i): bool => $i['kind'] === 'ref_to_deleted_asset'));
        self::assertCount(1, $ref);
        self::assertNull($ref[0]['fix']);
        self::assertSame('warning', $ref[0]['severity']);
    }

    public function testTrappedPathsAreRefused(): void
    {
        $admin = $this->user('Root', 'admin');
        foreach (['assets/../config.php', '../config.php', '/etc/passwd', 'assets/a//b', 'config.php'] as $path) {
            $response = $admin->post('/admin/integrity/fix', ['issues' => [['id' => 'orphan_file:' . $path, 'kind' => 'orphan_file', 'subject' => ['path' => $path]]], 'confirm' => true]);
            self::assertSame(422, $response->status(), $path);
            self::assertSame('integrity.invalid_path', self::errorCode($response));
        }
        // A well-formed path that is not an orphan: nothing is deleted.
        file_put_contents(self::$root . '/storage/keep.txt', 'x');
        $data = self::data($admin->post('/admin/integrity/fix', ['issues' => [['id' => 'orphan_file:assets/none.bin', 'kind' => 'orphan_file']], 'confirm' => true]));
        self::assertSame([], $data['fixed']);
        self::assertFileExists(self::$root . '/storage/keep.txt');
        self::assertSame(422, $admin->post('/admin/integrity/check', ['cursor' => '%%%'])->status());
    }
}
