<?php

declare(strict_types=1);

namespace JDR\Tests\MapsP4c;

use JDR\Core\Errors\ValidationException;
use JDR\Maps\ChunkCodec;
use JDR\Maps\Document\MapDocumentMigrator;
use JDR\Maps\Document\MapDocumentValidator;
use PHPUnit\Framework\TestCase;

/**
 * Map document (projet.md 12.1): strict validation, normalization and format migrations,
 * without database. Non-regression on tests/fixtures/maps/v1-sample.json.
 */
final class MapDocumentTest extends TestCase
{
    /**
     * @return array<string, mixed>
     */
    private static function fixture(): array
    {
        $json = (string) file_get_contents(dirname(__DIR__, 2) . '/fixtures/maps/v1-sample.json');

        return MapDocumentValidator::decode($json);
    }

    /**
     * @param array<string, mixed> $doc
     * @return array<string, string> fields of the refusal
     */
    private static function refusal(array $doc, ?MapDocumentValidator $validator = null, bool $internal = false): array
    {
        try {
            ($validator ?? new MapDocumentValidator())->validate($doc, $internal);
        } catch (ValidationException $e) {
            return $e->fields();
        }
        self::fail('The document was accepted.');
    }

    private static function block(string $raw): string
    {
        return base64_encode((string) gzdeflate($raw, 6));
    }

    public function testFixtureV1IsValidAndNormalized(): void
    {
        $doc = (new MapDocumentValidator())->validate(self::fixture());

        self::assertSame(
            ['format_version', 'name', 'kind', 'grid', 'theme', 'ambient', 'palette', 'layers', 'floors', 'chunks', 'objects', 'tokens_placed', 'fog', 'generation'],
            array_keys($doc),
        );
        self::assertSame(1, $doc['format_version']);
        self::assertSame('Crypte oubliée', $doc['name']);
        self::assertSame(['type' => 'square', 'cell_px' => 70, 'width' => 60, 'height' => 40, 'unit_label' => 'ft', 'unit_per_cell' => 5], $doc['grid']);
        self::assertCount(4, $doc['palette']);
        self::assertNull($doc['palette'][0]);
        self::assertSame(['sha256', 'name', 'autotile'], array_keys($doc['palette'][1]));
        self::assertSame('grass', $doc['palette'][2]['autotile']);
        self::assertSame([['uid' => 'f1', 'level' => 0, 'name' => 'Rez-de-chaussée']], $doc['floors']);
        self::assertSame(
            [['f1', 'ground', 0, 0], ['f1', 'ground', 1, 0], ['f1', 'terrain', 0, 0]],
            array_map(static fn (array $c): array => [$c['floor'], $c['layer'], $c['cx'], $c['cy']], $doc['chunks']),
        );
        foreach ($doc['chunks'] as $chunk) {
            self::assertSame(ChunkCodec::RAW_BYTES, strlen($chunk['raw']));
        }
        self::assertSame('dungeon-bsp', $doc['generation']['generator']);
    }

    public function testChunksAreCanonicalized(): void
    {
        $d = self::fixture();
        $raw = ChunkCodec::emptyRaw('decor');
        $raw[4] = "\x07";                                                     // reserved header byte
        $raw[ChunkCodec::offset(3, 3) + 2] = "\x09";                          // variant of an empty cell
        ChunkCodec::setCell($raw, ChunkCodec::offset(4, 4), 2, 3, 15);
        $d['chunks']['f1']['decor'] = ['0:1' => self::block($raw), '1:1' => self::block(ChunkCodec::emptyRaw('decor'))];
        $doc = (new MapDocumentValidator())->validate($d);

        $decor = array_values(array_filter($doc['chunks'], static fn (array $c): bool => $c['layer'] === 'decor'));
        self::assertCount(1, $decor, 'the empty block is dropped');
        self::assertSame("\0\0\0\0", substr($decor[0]['raw'], 4, 4));
        self::assertSame([0, 0, 0], ChunkCodec::cellAt($decor[0]['raw'], ChunkCodec::offset(3, 3)));
        self::assertSame("\0\0\0\0", substr($decor[0]['raw'], ChunkCodec::offset(3, 3), 4));
        self::assertSame([2, 3, 15], ChunkCodec::cellAt($decor[0]['raw'], ChunkCodec::offset(4, 4)));
    }

    public function testStrictRules(): void
    {
        $cases = [
            ['flags', static function (array $d): array {
                $raw = ChunkCodec::emptyRaw('ground');
                ChunkCodec::setCell($raw, ChunkCodec::offset(0, 0), 1, 0, 16);
                $d['chunks']['f1']['ground']['0:0'] = base64_encode((string) gzdeflate($raw));

                return $d;
            }, ['chunks.f1.ground.0:0' => 'bad_flags']],
            ['base64', static function (array $d): array {
                $d['chunks']['f1']['ground']['0:0'] = '***';

                return $d;
            }, ['chunks.f1.ground.0:0' => 'invalid']],
            ['oversized block', static function (array $d): array {
                $d['chunks']['f1']['ground']['0:0'] = str_repeat('A', 8196);

                return $d;
            }, ['chunks.f1.ground.0:0' => 'too_large']],
            ['bad key', static function (array $d): array {
                $d['chunks']['f1']['ground']['0-0'] = $d['chunks']['f1']['ground']['0:0'];

                return $d;
            }, ['chunks.f1.ground.0-0' => 'invalid']],
            ['object layer', static function (array $d): array {
                $d['chunks']['f1']['walls'] = [];

                return $d;
            }, ['chunks.f1' => 'invalid']],
            ['slot 0', static function (array $d): array {
                $d['palette'][0] = $d['palette'][1];

                return $d;
            }, ['palette.0' => 'invalid']],
            ['palette extra key', static function (array $d): array {
                $d['palette'][1]['url'] = 'http://x';

                return $d;
            }, ['palette.1' => 'invalid']],
            ['asset_id outside snapshots', static function (array $d): array {
                $d['palette'][1]['asset_id'] = '12';

                return $d;
            }, ['palette.1' => 'invalid']],
            ['duplicate floor', static function (array $d): array {
                $d['floors'][] = ['uid' => 'f1', 'level' => 0, 'name' => 'Bis'];

                return $d;
            }, ['floors.1.uid' => 'duplicate', 'floors.1.level' => 'duplicate']],
            ['too many floors', static function (array $d): array {
                for ($i = 1; $i <= 8; $i++) {
                    $d['floors'][] = ['uid' => 'f' . ($i + 1), 'level' => $i, 'name' => 'N' . $i];
                }

                return $d;
            }, ['floors' => 'too_many']],
            ['hex grid', static function (array $d): array {
                $d['grid']['type'] = 'hex';

                return $d;
            }, ['grid.type' => 'unsupported']],
            ['missing grid size', static function (array $d): array {
                unset($d['grid']['height']);

                return $d;
            }, ['grid.height' => 'required']],
            ['layers', static function (array $d): array {
                $d['layers'] = [['id' => 'ground', 'kind' => 'objects']];

                return $d;
            }, ['layers.0' => 'invalid']],
            ['ambient', static function (array $d): array {
                $d['ambient']['tint'] = 'red';

                return $d;
            }, ['ambient.tint' => 'invalid']],
            ['generation', static function (array $d): array {
                $d['generation']['seed'] = ['x'];

                return $d;
            }, ['generation.seed' => 'invalid']],
            ['fog block (P5)', static function (array $d): array {
                $d['fog'] = ['f1' => ['0:0' => 'AAAA']];

                return $d;
            }, ['fog.f1.0:0' => 'invalid']],
            ['notes (P9)', static function (array $d): array {
                $d['notes'] = [['uid' => 'n1']];

                return $d;
            }, ['notes' => 'unsupported']],
            ['missing chunks', static function (array $d): array {
                unset($d['chunks']);

                return $d;
            }, ['chunks' => 'required']],
            ['Constructor key', static function (array $d): array {
                $d['ambient']['Constructor'] = 1;

                return $d;
            }, ['ambient.Constructor' => 'dangerous_key']],
            ['format_version as text', static function (array $d): array {
                $d['format_version'] = '1';

                return $d;
            }, ['format_version' => 'invalid']],
        ];
        foreach ($cases as [$label, $trap, $expected]) {
            self::assertSame($expected, array_intersect_key(self::refusal($trap(self::fixture())), $expected), $label);
        }
    }

    public function testSnapshotsMayCarryAssetIds(): void
    {
        $d = self::fixture();
        $d['palette'][1]['asset_id'] = '42';
        $doc = (new MapDocumentValidator())->validate($d, true);
        self::assertSame(42, $doc['palette'][1]['asset_id']);
        self::assertArrayNotHasKey('asset_id', $doc['palette'][2]);
        $d['palette'][1]['asset_id'] = 'x';
        self::assertSame(['palette.1.asset_id' => 'invalid'], self::refusal($d, null, true));
    }

    public function testDecodeIsBounded(): void
    {
        self::assertSame('jdr-map', MapDocumentValidator::decode("\xEF\xBB\xBF" . '{"format":"jdr-map"}')['format']);
        foreach (['', 'null', '"x"', '[1]', '{', str_repeat('[', 100) . str_repeat(']', 100)] as $json) {
            try {
                MapDocumentValidator::decode($json);
                self::fail('Accepted: ' . $json);
            } catch (ValidationException $e) {
                self::assertSame('invalid_map_file', $e->errorCode());
            }
        }
    }

    public function testMigrationsRunStepByStep(): void
    {
        $steps = [
            1 => static function (array $doc): array {
                $doc['name'] .= ' (v2)';

                return $doc;
            },
            2 => static function (array $doc): array {
                $doc['theme'] = 'dark';

                return $doc;
            },
        ];
        $migrator = new MapDocumentMigrator(3, $steps);
        $migrated = $migrator->migrate(self::fixture());
        self::assertSame(3, $migrated['format_version']);
        self::assertSame('Crypte oubliée (v2)', $migrated['name']);
        self::assertSame('dark', $migrated['theme']);

        $validated = (new MapDocumentValidator($migrator))->validate(self::fixture());
        self::assertSame(3, $validated['format_version']);
        self::assertSame('dark', $validated['theme']);

        $future = self::fixture();
        $future['format_version'] = 4;
        try {
            $migrator->migrate($future);
            self::fail('A future format was accepted.');
        } catch (ValidationException $e) {
            self::assertSame('unsupported_format_version', $e->errorCode());
            self::assertSame(['format_version' => 'unsupported'], $e->fields());
        }
        // The current version needs no step.
        self::assertSame(self::fixture(), (new MapDocumentMigrator())->migrate(self::fixture()));
        $this->expectException(\LogicException::class);
        (new MapDocumentMigrator(2, []))->migrate(self::fixture());
    }
}
