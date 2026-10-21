<?php

declare(strict_types=1);

namespace JDR\Tests\Imaging;

use JDR\Imaging\ImageRejected;
use PHPUnit\Framework\TestCase;

/**
 * Shared helpers: a fresh work directory per test and the fixture corpus path.
 */
abstract class ImagingTestCase extends TestCase
{
    protected string $work;

    protected function setUp(): void
    {
        $this->work = sys_get_temp_dir() . '/jdr-imaging-' . bin2hex(random_bytes(6));
        mkdir($this->work, 0700, true);
    }

    protected function tearDown(): void
    {
        foreach (glob($this->work . '/*') ?: [] as $file) {
            unlink($file);
        }
        rmdir($this->work);
    }

    protected static function fixture(string $name): string
    {
        $path = JDR_ROOT . '/tests/fixtures/uploads/' . $name;
        self::assertFileExists($path, 'Run php dev/fixtures/make-uploads.php');

        return $path;
    }

    /** @return list<string> */
    protected function workFiles(): array
    {
        return array_map('basename', glob($this->work . '/*') ?: []);
    }

    protected static function assertRejected(callable $fn, string $code, ?string $reason = null): ImageRejected
    {
        try {
            $fn();
        } catch (ImageRejected $e) {
            self::assertSame($code, $e->errorCode(), $e->detail());
            if ($reason !== null) {
                self::assertSame($reason, $e->reason(), $e->detail());
            }

            return $e;
        }
        self::fail("ImageRejected {$code} expected.");
    }
}
