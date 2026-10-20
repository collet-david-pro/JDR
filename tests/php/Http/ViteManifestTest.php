<?php

declare(strict_types=1);

namespace JDR\Tests\Http;

use JDR\Http\Shell;
use JDR\Http\ViteManifest;
use PHPUnit\Framework\TestCase;

final class ViteManifestTest extends TestCase
{
    public function testEntryCollectsCssRecursivelyAndPreloads(): void
    {
        $manifest = ViteManifest::fromArray([
            'src/main.ts' => ['file' => 'assets/main.js', 'css' => ['assets/main.css'], 'imports' => ['_a.js']],
            '_a.js' => ['file' => 'assets/a.js', 'css' => ['assets/a.css'], 'imports' => ['_b.js', 'src/main.ts']],
            '_b.js' => ['file' => 'assets/b.js', 'css' => ['assets/main.css']],
            'src/lazy.ts' => ['file' => 'assets/lazy.js', 'isDynamicEntry' => true],
        ]);
        self::assertSame([
            'file' => 'assets/main.js',
            'css' => ['assets/main.css', 'assets/a.css'],
            'preload' => ['assets/a.js', 'assets/b.js'],
        ], $manifest->entry('src/main.ts'));
        self::assertNull($manifest->entry('src/other.ts'));
    }

    public function testUnsafePathsAreIgnored(): void
    {
        self::assertNull(ViteManifest::fromArray(['src/main.ts' => ['file' => '../x.js']])->entry());
        self::assertNull(ViteManifest::fromArray(['src/main.ts' => ['file' => 'https://evil/x.js']])->entry());
        self::assertSame(
            ['file' => 'assets/m.js', 'css' => [], 'preload' => []],
            ViteManifest::fromArray(['src/main.ts' => ['file' => 'assets/m.js', 'css' => ['/abs.css', '"x.css']]])->entry(),
        );
    }

    public function testMissingOrInvalidFile(): void
    {
        self::assertNull(ViteManifest::load('/nonexistent/vite-manifest.json'));
        $file = tempnam(sys_get_temp_dir(), 'jdrvm');
        file_put_contents($file, 'not json');
        try {
            self::assertNull(ViteManifest::load($file));
        } finally {
            unlink($file);
        }
    }

    public function testBootJsonCannotBreakOutOfScript(): void
    {
        $json = Shell::encodeBootData(['base_path' => '</script><script>alert(1)</script>', 'x' => "&'\""]);
        self::assertStringNotContainsString('<', $json);
        self::assertStringNotContainsString('>', $json);
        self::assertStringNotContainsString('&', $json);
        self::assertStringNotContainsString("'", $json);
        self::assertSame(
            ['base_path' => '</script><script>alert(1)</script>', 'x' => "&'\""],
            json_decode($json, true),
        );
    }

    public function testBootDataShape(): void
    {
        self::assertSame([
            'version' => \APP_VERSION,
            'api_base' => '/index.php?r=/api/v1',
            'routing_mode' => 'query',
            'base_path' => '',
            'csrf' => null,
        ], Shell::bootData('', 'query', null));
    }
}
