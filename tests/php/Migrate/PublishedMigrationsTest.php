<?php

declare(strict_types=1);

namespace JDR\Tests\Migrate;

use PHPUnit\Framework\TestCase;

/**
 * A delivered migration never changes: every file of migrations/ that exists in a published tag is identical to
 * the one of the tag. Skipped when git or the tags are not there (release archive, shallow clone).
 */
final class PublishedMigrationsTest extends TestCase
{
    private const TAGS = ['v0.1.0-alpha.1', 'v0.1.0-alpha.2', 'v0.2.0'];

    private static function git(string ...$args): ?string
    {
        if (!function_exists('proc_open')) {
            return null;
        }
        $root = dirname(__DIR__, 3);
        $process = @proc_open(array_merge(['git', '-C', $root], $args), [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
        if (!is_resource($process)) {
            return null;
        }
        $out = (string) stream_get_contents($pipes[1]);
        stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);

        return proc_close($process) === 0 ? $out : null;
    }

    public function testDeliveredMigrationsAreIdenticalToTheirTag(): void
    {
        if (self::git('rev-parse', '--git-dir') === null) {
            self::markTestSkipped('git is not available here.');
        }
        $checked = 0;
        foreach (self::TAGS as $tag) {
            $list = self::git('ls-tree', '--name-only', $tag, 'migrations/');
            if ($list === null) {
                continue; // tag missing
            }
            foreach (array_filter(explode("\n", $list)) as $path) {
                if (!preg_match('#^migrations/\d{4}_[^/]+\.(sql|php)$#', $path)) {
                    continue;
                }
                $published = self::git('show', $tag . ':' . $path);
                self::assertNotNull($published, $path);
                $current = dirname(__DIR__, 3) . '/' . $path;
                self::assertFileExists($current, $tag . ' ' . $path . ' was deleted');
                self::assertSame($published, (string) file_get_contents($current), $tag . ' ' . $path . ' was modified after its release: write a new migration instead');
                $checked++;
            }
        }
        if ($checked === 0) {
            self::markTestSkipped('No published tag found in this repository.');
        }
        self::assertGreaterThan(0, $checked);
    }
}
