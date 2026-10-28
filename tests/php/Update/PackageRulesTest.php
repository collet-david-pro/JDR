<?php

declare(strict_types=1);

namespace JDR\Tests\Update;

use JDR\Domain\Update\PackageRules;
use PHPUnit\Framework\TestCase;

/**
 * The files accepted in an update archive must match what dev/release.mjs ships: a file shipped
 * but not accepted would make every later update archive fail with update.unsafe_path.
 */
final class PackageRulesTest extends TestCase
{
    public function testRootFilesAndDirsMirrorTheReleaseScript(): void
    {
        $script = (string) file_get_contents(dirname(__DIR__, 3) . '/dev/release.mjs');
        self::assertSame(1, preg_match('/const ROOT_FILES = \[(.*?)\];/s', $script, $files));
        self::assertSame(1, preg_match('/const ROOT_DIRS = \[(.*?)\];/s', $script, $dirs));
        preg_match_all("/'([^']+)'/", $files[1], $shippedFiles);
        preg_match_all("/'([^']+)'/", $dirs[1], $shippedDirs);

        $expected = array_values(array_diff($shippedFiles[1], ['install.php']));
        $expected[] = PackageRules::MANIFEST;
        sort($expected);
        $accepted = PackageRules::ROOT_FILES;
        sort($accepted);
        self::assertSame($expected, $accepted);
        self::assertSame($shippedDirs[1], PackageRules::ROOT_DIRS);
    }
}
