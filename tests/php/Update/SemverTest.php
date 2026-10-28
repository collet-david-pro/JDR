<?php

declare(strict_types=1);

namespace JDR\Tests\Update;

use JDR\Domain\Update\PackageRules;
use JDR\Domain\Update\Semver;
use PHPUnit\Framework\TestCase;

final class SemverTest extends TestCase
{
    public function testParseAndNormalize(): void
    {
        self::assertSame('1.2.3', Semver::normalize('v1.2.3+build.5'));
        self::assertSame('1.0.0-alpha.1', Semver::normalize('1.0.0-alpha.1'));
        self::assertSame(['alpha', '1'], Semver::parse('1.0.0-alpha.1')['pre'] ?? null);
        foreach (['1.2', '1.2.3.4', '01.2.3', '1.2.3-', 'abc', '', '1.2.3-a..b'] as $bad) {
            self::assertNull(Semver::parse($bad), $bad);
        }
        self::assertTrue(Semver::isPrerelease('0.2.0-beta.1'));
        self::assertFalse(Semver::isPrerelease('0.2.0'));
    }

    public function testFullOrdering(): void
    {
        // semver.org §11 example, plus multi-digit numbers.
        $ordered = [
            '0.9.9', '1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.2', '1.0.0-alpha.10', '1.0.0-alpha.beta',
            '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0', '1.0.1', '1.2.0', '1.10.0', '2.0.0',
        ];
        $count = count($ordered);
        for ($i = 0; $i < $count; $i++) {
            for ($j = 0; $j < $count; $j++) {
                self::assertSame($i <=> $j, Semver::compare($ordered[$i], $ordered[$j]), $ordered[$i] . ' vs ' . $ordered[$j]);
            }
        }
        $shuffled = $ordered;
        shuffle($shuffled);
        usort($shuffled, [Semver::class, 'compare']);
        self::assertSame($ordered, $shuffled);
        self::assertSame(0, Semver::compare('v1.0.0+a', '1.0.0+b'));
        self::assertTrue(Semver::greaterThan('0.2.0-alpha.1', '0.1.0'));
        self::assertFalse(Semver::greaterThan('0.2.0-alpha.1', '0.2.0'));
    }

    public function testPackageRules(): void
    {
        foreach (['index.php', 'update.php', 'manifest.json', 'app/Core/App.php', 'migrations/0005_x.sql', 'assets/a.js', 'i18n/fr.json', 'app/.htaccess'] as $ok) {
            self::assertTrue(PackageRules::isAllowed($ok), $ok);
        }
        foreach (['config.php', 'install.php', 'storage/x', 'Storage/x', '.git/config', 'app/../config.php', 'tests/x.php',
            'README.md', 'app', 'app/', '/index.php', 'app\\x.php', "app/x\0.php", 'dev/x.mjs'] as $bad) {
            self::assertFalse(PackageRules::isAllowed($bad), $bad);
        }
        self::assertSame(
            ['VERSION', 'app/A.php', 'index.php', 'app/Domain/Update/X.php', 'update.php', 'manifest.json'],
            PackageRules::copyOrder(['manifest.json', 'update.php', 'index.php', 'app/Domain/Update/X.php', 'app/A.php', 'VERSION']),
        );
    }
}
