<?php

declare(strict_types=1);

namespace JDR\Tests\Maps;

use JDR\Core\Response;
use JDR\Maps\ChunkCodec;
use JDR\Tests\Api\ApiClient;
use JDR\Tests\Games\GamesTestCase;

/**
 * API tests of maps (contract P4b).
 */
abstract class MapsTestCase extends GamesTestCase
{
    private int $opCounter = 0;

    /**
     * @param array<string, mixed> $body
     * @return array<string, mixed> Map
     */
    protected function newMap(ApiClient $editor, string $gameId, array $body = []): array
    {
        $response = $editor->post('/games/' . $gameId . '/maps', $body + ['name' => 'Crypte', 'width' => 60, 'height' => 40]);
        self::assertSame(201, $response->status(), $response->body());

        return self::data($response);
    }

    /**
     * POST /maps/{id}/ops with a fresh client_op_id (unless given).
     *
     * @param list<array<string, mixed>> $ops
     */
    protected function sendOps(ApiClient $editor, string $mapId, array $ops, ?int $baseRevision = null, ?string $clientOpId = null): Response
    {
        if ($baseRevision === null) {
            $baseRevision = (int) $this->db->fetchValue('SELECT `revision` FROM ' . $this->db->t('maps') . ' WHERE `id` = ?', [(int) $mapId]);
        }

        return $editor->post('/maps/' . $mapId . '/ops', [
            'base_revision' => $baseRevision,
            'client_op_id' => $clientOpId ?? 'op-' . (++$this->opCounter) . '-' . bin2hex(random_bytes(4)),
            'ops' => $ops,
        ]);
    }

    /**
     * @param list<array<string, mixed>> $ops
     * @return array<string, mixed> {revision, applied, conflicts}
     */
    protected function opsOk(ApiClient $editor, string $mapId, array $ops): array
    {
        $response = $this->sendOps($editor, $mapId, $ops);
        self::assertSame(200, $response->status(), $response->body());

        return self::data($response);
    }

    /**
     * @param list<array{0: int, 1: int, 2: int, 3?: int, 4?: int}> $cells
     * @return array<string, mixed>
     */
    protected static function tiles(string $floorId, string $layer, array $cells): array
    {
        return [
            'type' => 'tiles.set',
            'floor' => $floorId,
            'layer' => $layer,
            'cells' => array_map(static fn (array $c): array => [$c[0], $c[1], $c[2], $c[3] ?? 0, $c[4] ?? 0], $cells),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected static function paletteAdd(int $index, string $assetId): array
    {
        return ['type' => 'palette.add', 'index' => $index, 'asset_id' => $assetId];
    }

    /**
     * Parses the binary body of GET /maps/{id}/chunks.
     *
     * @return list<array{cx: int, cy: int, layer: int, data: string}>
     */
    protected static function parseChunks(string $body): array
    {
        $out = [];
        $offset = 0;
        $length = strlen($body);
        while ($offset < $length) {
            self::assertGreaterThanOrEqual(9, $length - $offset, 'truncated record header');
            $head = unpack('vcx/vcy/Clayer/Vlen', substr($body, $offset, 9));
            self::assertIsArray($head);
            $offset += 9;
            $data = substr($body, $offset, $head['len']);
            self::assertSame($head['len'], strlen($data), 'truncated record data');
            $offset += $head['len'];
            $out[] = ['cx' => $head['cx'], 'cy' => $head['cy'], 'layer' => $head['layer'], 'data' => $data];
        }

        return $out;
    }

    /**
     * Cell values of a map read back from map_chunks: "floor|layer|x,y" => [index, variant, flags].
     *
     * @return array<string, array{0: int, 1: int, 2: int}>
     */
    protected function storedCells(string $mapId): array
    {
        $rows = $this->db->fetchAll(
            'SELECT `floor_id`, `layer`, `cx`, `cy`, `data` FROM ' . $this->db->t('map_chunks') . ' WHERE `map_id` = ?',
            [(int) $mapId],
        );
        $cells = [];
        foreach ($rows as $r) {
            $raw = ChunkCodec::decode((string) $r['data'], (string) $r['layer'], 0x10000);
            self::assertFalse(ChunkCodec::isEmpty($raw), 'an empty chunk is stored');
            for ($y = 0; $y < 32; $y++) {
                for ($x = 0; $x < 32; $x++) {
                    $cell = ChunkCodec::cellAt($raw, ChunkCodec::offset($x, $y));
                    if ($cell[0] !== 0) {
                        $cells[$r['floor_id'] . '|' . $r['layer'] . '|' . ((int) $r['cx'] * 32 + $x) . ',' . ((int) $r['cy'] * 32 + $y)] = $cell;
                    }
                }
            }
        }
        ksort($cells);

        return $cells;
    }

    /**
     * map_asset_refs recomputed from scratch (every stored cell, through the palette).
     *
     * @return array<int, int>
     */
    protected function recountRefs(string $mapId): array
    {
        $palette = json_decode((string) $this->db->fetchValue(
            'SELECT `palette` FROM ' . $this->db->t('maps') . ' WHERE `id` = ?',
            [(int) $mapId],
        ), true);
        $counts = [];
        foreach ($this->storedCells($mapId) as [$index]) {
            $assetId = (int) $palette[$index]['asset_id'];
            $counts[$assetId] = ($counts[$assetId] ?? 0) + 1;
        }
        ksort($counts);

        return $counts;
    }

    /**
     * @return array<int, int>
     */
    protected function storedRefs(string $mapId): array
    {
        $rows = $this->db->fetchAll(
            'SELECT `asset_id`, `ref_count` FROM ' . $this->db->t('map_asset_refs') . ' WHERE `map_id` = ? ORDER BY `asset_id`',
            [(int) $mapId],
        );
        $out = [];
        foreach ($rows as $r) {
            $out[(int) $r['asset_id']] = (int) $r['ref_count'];
        }

        return $out;
    }

    protected function revision(string $mapId): int
    {
        return (int) $this->db->fetchValue('SELECT `revision` FROM ' . $this->db->t('maps') . ' WHERE `id` = ?', [(int) $mapId]);
    }

    /**
     * GM with a game, a map and two palette assets [1 => asset A, 2 => asset B].
     *
     * @return array{gm: ApiClient, game: array<string, mixed>, map: array<string, mixed>, floor: string, a: array<string, mixed>, b: array<string, mixed>}
     */
    protected function scene(array $mapBody = []): array
    {
        $gm = $this->user('Alice');
        $game = $this->newGame($gm);
        $a = $this->uploadOk($gm, 'valid_png_opaque.png', ['kind' => 'tile']);
        $b = $this->uploadOk($gm, 'valid_png_transparent.png', ['kind' => 'tile']);
        $map = $this->newMap($gm, $game['id'], $mapBody);
        $this->opsOk($gm, $map['id'], [self::paletteAdd(1, $a['id']), self::paletteAdd(2, $b['id'])]);

        return ['gm' => $gm, 'game' => $game, 'map' => $map, 'floor' => $map['floors'][0]['id'], 'a' => $a, 'b' => $b];
    }
}
