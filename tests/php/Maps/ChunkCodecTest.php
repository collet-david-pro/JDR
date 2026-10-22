<?php

declare(strict_types=1);

namespace JDR\Tests\Maps;

use JDR\Maps\ChunkCodec;
use JDR\Maps\ChunkCodecException;
use PHPUnit\Framework\TestCase;

/**
 * Server chunk codec (projet.md 12.2) against the front codec:
 * - decodes the 5 vectors of frontend/tests/formats/fixtures/php-chunks.json;
 * - produces tests/php/Maps/fixtures/php-to-js-chunks.json (PHP -> JS vectors, kept in sync:
 *   JDR_REGEN_FIXTURES=1 rewrites it), whose deflate-raw data is checked with Node's zlib when
 *   Node is available.
 */
final class ChunkCodecTest extends TestCase
{
    private const FRONT_FIXTURE = '/frontend/tests/formats/fixtures/php-chunks.json';
    private const PHP_FIXTURE = '/tests/php/Maps/fixtures/php-to-js-chunks.json';

    private static function root(): string
    {
        return dirname(__DIR__, 3);
    }

    public function testDecodesTheFrontVectors(): void
    {
        $fixture = json_decode((string) file_get_contents(self::root() . self::FRONT_FIXTURE), true, 512, JSON_THROW_ON_ERROR);
        self::assertCount(5, $fixture['vectors']);
        foreach ($fixture['vectors'] as $v) {
            $raw = base64_decode($v['raw'], true);
            $layer = ChunkCodec::layerName($v['layer']);
            self::assertNotNull($layer);
            self::assertSame($raw, ChunkCodec::decode(base64_decode($v['compressed'], true), $layer, 0x10000), $v['name']);
            self::assertSame($layer, ChunkCodec::layerOf($raw));
            // Our own compression of the same raw block round-trips too.
            self::assertSame($raw, ChunkCodec::inflate(ChunkCodec::compress($raw)), $v['name']);
        }
        $full = base64_decode($fixture['vectors'][4]['raw'], true);
        self::assertSame([65535, 255, 255], ChunkCodec::cellAt($full, ChunkCodec::offset(31, 31)));
        self::assertSame([65535 => 1024], ChunkCodec::indexCounts($full));
    }

    public function testCellLayoutIsRowMajorLittleEndian(): void
    {
        $raw = ChunkCodec::emptyRaw('terrain');
        self::assertSame(ChunkCodec::RAW_BYTES, strlen($raw));
        self::assertSame("JC\x01\x01\0\0\0\0", substr($raw, 0, 8));
        self::assertTrue(ChunkCodec::isEmpty($raw));
        ChunkCodec::setCell($raw, ChunkCodec::offset(1, 2), 0x0102, 7, 9);
        self::assertSame("\x02\x01\x07\x09", substr($raw, 8 + (2 * 32 + 1) * 4, 4));
        self::assertSame([258, 7, 9], ChunkCodec::cellAt($raw, ChunkCodec::offset(1, 2)));
        self::assertFalse(ChunkCodec::isEmpty($raw));
        self::assertSame([258 => 1], ChunkCodec::indexCounts($raw));
        ChunkCodec::setCell($raw, ChunkCodec::offset(1, 2), 0, 7, 9);
        self::assertSame("\0\0\0\0", substr($raw, 8 + (2 * 32 + 1) * 4, 4), 'an empty cell is all zeros');
        self::assertTrue(ChunkCodec::isEmpty($raw));
    }

    public function testRejectsInvalidBlocks(): void
    {
        $raw = ChunkCodec::emptyRaw('ground');
        ChunkCodec::setCell($raw, ChunkCodec::offset(0, 0), 5, 0, 0);
        $cases = [
            'bad_compression' => ['garbage', 'ground', 10],
            'bad_size' => [gzdeflate(substr($raw, 0, 4100)), 'ground', 10],
            'bad_magic' => [gzdeflate('XC' . substr($raw, 2)), 'ground', 10],
            'bad_version' => [gzdeflate("JC\x02" . substr($raw, 3)), 'ground', 10],
            'bad_layer' => [gzdeflate($raw), 'decor', 10],
            'bad_palette_index' => [gzdeflate($raw), 'ground', 5],
        ];
        foreach ($cases as $code => [$data, $layer, $palette]) {
            try {
                ChunkCodec::decode($data, $layer, $palette);
                self::fail('expected ' . $code);
            } catch (ChunkCodecException $e) {
                self::assertSame($code, $e->reason);
            }
        }
        try {
            ChunkCodec::decode(gzdeflate("JC\x01\x03" . substr($raw, 4)), null, 10);
            self::fail('unknown layer code');
        } catch (ChunkCodecException $e) {
            self::assertSame('bad_layer', $e->reason);
        }
        self::assertSame($raw, ChunkCodec::decode(gzdeflate($raw), 'ground', 6));
    }

    public function testDecompressionIsBounded(): void
    {
        $bomb = gzdeflate(str_repeat("\0", 20_000_000), 9);
        $before = memory_get_peak_usage();
        try {
            ChunkCodec::inflate($bomb);
            self::fail('bomb accepted');
        } catch (ChunkCodecException $e) {
            self::assertContains($e->reason, ['bad_compression', 'bad_size']);
        }
        self::assertLessThan(8 * 1024 * 1024, memory_get_peak_usage() - $before);
        foreach ([4105, 8192] as $length) {
            try {
                ChunkCodec::inflate(gzdeflate(str_repeat('a', $length)));
                self::fail('oversized block accepted');
            } catch (ChunkCodecException $e) {
                self::assertContains($e->reason, ['bad_compression', 'bad_size']);
            }
        }
    }

    public function testPhpToJsVectorsAreUpToDateAndReadableByZlib(): void
    {
        $vectors = self::phpVectors();
        $path = self::root() . self::PHP_FIXTURE;
        $json = json_encode([
            'generator' => 'tests/php/Maps/ChunkCodecTest.php (JDR\\Maps\\ChunkCodec::compress, gzdeflate level 6)',
            'format' => 'raw = 4104-byte block (projet.md 12.2), compressed = deflate-raw; both base64',
            'vectors' => $vectors,
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n";
        if (getenv('JDR_REGEN_FIXTURES') === '1') {
            file_put_contents($path, $json);
        }
        self::assertFileExists($path);
        $stored = json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
        self::assertSame(array_column($vectors, 'raw', 'name'), array_column($stored['vectors'], 'raw', 'name'), 'raw blocks changed: regenerate the fixture');
        foreach ($stored['vectors'] as $v) {
            $layer = (string) ChunkCodec::layerName($v['layer']);
            self::assertSame(base64_decode($v['raw'], true), ChunkCodec::decode(base64_decode($v['compressed'], true), $layer, 0x10000));
        }

        $node = trim((string) shell_exec('command -v node 2>/dev/null'));
        if ($node === '') {
            self::markTestIncomplete('node not found: zlib cross-check skipped');
        }
        $script = 'const z=require("zlib");const f=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));'
            . 'let ok=0;for(const v of f.vectors){const r=z.inflateRawSync(Buffer.from(v.compressed,"base64"));'
            . 'if(r.length!==4104||!r.equals(Buffer.from(v.raw,"base64"))){console.log("FAIL "+v.name);process.exit(1);}ok++;}console.log("OK "+ok);';
        $out = shell_exec(escapeshellarg($node) . ' -e ' . escapeshellarg($script) . ' ' . escapeshellarg($path) . ' 2>&1');
        self::assertSame('OK ' . count($vectors), trim((string) $out));
    }

    /**
     * Deterministic PHP -> JS vectors built with the production API.
     *
     * @return list<array{name: string, layer: int, raw: string, compressed: string}>
     */
    private static function phpVectors(): array
    {
        $seed = 777;
        $rand = static function () use (&$seed): int {
            $seed = ($seed * 1103515245 + 12345) & 0x7fffffff;

            return $seed;
        };
        $build = static function (string $layer, callable $cell): string {
            $raw = ChunkCodec::emptyRaw($layer);
            for ($i = 0; $i < ChunkCodec::CELLS; $i++) {
                [$index, $variant, $flags] = $cell($i);
                ChunkCodec::setCell($raw, ChunkCodec::offset($i & 31, $i >> 5), $index, $variant, $flags);
            }

            return $raw;
        };
        $blocks = [
            'php-ground-diagonal' => $build('ground', static fn (int $i): array => ($i & 31) === ($i >> 5) ? [1, 0, 0] : [0, 0, 0]),
            'php-terrain-random' => $build('terrain', static function () use ($rand): array {
                $r = $rand();

                return $r % 3 === 0 ? [0, 0, 0] : [1 + $r % 500, ($r >> 8) % 256, ($r >> 16) % 16];
            }),
            'php-decor-corner' => $build('decor', static fn (int $i): array => $i === 1023 ? [4095, 255, 15] : [0, 0, 0]),
            'php-ground-full' => $build('ground', static fn (int $i): array => [1 + ($i % 7), $i % 3, $i % 16]),
        ];
        $out = [];
        foreach ($blocks as $name => $raw) {
            $out[] = [
                'name' => $name,
                'layer' => ChunkCodec::layerCode((string) ChunkCodec::layerOf($raw)),
                'raw' => base64_encode($raw),
                'compressed' => base64_encode(ChunkCodec::compress($raw)),
            ];
        }

        return $out;
    }
}
