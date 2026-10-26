<?php

declare(strict_types=1);

namespace JDR\Tests\Sessions;

use JDR\Domain\Sessions\CodeGenerator;
use PHPUnit\Framework\TestCase;

require_once dirname(__DIR__) . '/Support/boot.php';

final class CodeGeneratorTest extends TestCase
{
    public function testFormat(): void
    {
        $seen = [];
        for ($i = 0; $i < 300; $i++) {
            $code = CodeGenerator::random();
            self::assertMatchesRegularExpression('/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/', $code);
            $seen[$code] = true;
        }
        self::assertGreaterThan(295, count($seen));
        self::assertStringNotContainsString('0', CodeGenerator::ALPHABET);
        self::assertStringNotContainsString('O', CodeGenerator::ALPHABET);
        self::assertStringNotContainsString('1', CodeGenerator::ALPHABET);
        self::assertStringNotContainsString('I', CodeGenerator::ALPHABET);
        self::assertSame(32, strlen(CodeGenerator::ALPHABET));
    }

    public function testNormalize(): void
    {
        self::assertSame('K7F2QM9X', CodeGenerator::normalize('K7F2-QM9X'));
        self::assertSame('K7F2QM9X', CodeGenerator::normalize('k7f2qm9x'));
        self::assertSame('K7F2QM9X', CodeGenerator::normalize("  k7f2 - qm9x\n"));
        self::assertSame('K7F2QM9X', CodeGenerator::normalize('K 7 F 2 Q M 9 X'));
        foreach (['', 'K7F2QM9', 'K7F2QM9XX', 'K7F2QM90', 'K7F2QMOX', 'K7F2QM1X', 'K7F2_QM9X', 'K7F2.QM9X', 'é7F2QM9X'] as $bad) {
            self::assertNull(CodeGenerator::normalize($bad), $bad);
        }
        foreach ([null, 12345678, ['K7F2QM9X'], true] as $bad) {
            self::assertNull(CodeGenerator::normalize($bad));
        }
        self::assertSame('K7F2-QM9X', CodeGenerator::format('K7F2QM9X'));
    }

    public function testUniquenessRetriesFiveTimes(): void
    {
        $generator = new CodeGenerator();
        $tries = 0;
        $code = $generator->generate(static function (string $c) use (&$tries): bool {
            return ++$tries < 5;
        });
        self::assertSame(5, $tries, 'the fifth try is accepted');
        self::assertSame(8, strlen($code));

        $tries = 0;
        try {
            $generator->generate(static function () use (&$tries): bool {
                $tries++;

                return true;
            });
            self::fail('no free code');
        } catch (\RuntimeException) {
            self::assertSame(5, $tries);
        }
    }
}
