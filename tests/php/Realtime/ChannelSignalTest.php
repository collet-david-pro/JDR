<?php

declare(strict_types=1);

namespace JDR\Tests\Realtime;

use JDR\Domain\Support\AppPaths;
use JDR\Realtime\ChannelSignal;
use JDR\Realtime\Every;
use PHPUnit\Framework\TestCase;

/**
 * Witness files (projet.md 10.4) and the Every throttle of the loop listeners.
 */
final class ChannelSignalTest extends TestCase
{
    private string $dir;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir() . '/jdr-signal-' . bin2hex(random_bytes(4));
    }

    protected function tearDown(): void
    {
        foreach (glob($this->dir . '/cache/ch/*') ?: [] as $file) {
            @unlink($file);
        }
        @rmdir($this->dir . '/cache/ch');
        @rmdir($this->dir . '/cache');
        @rmdir($this->dir);
    }

    public function testFingerprintChangesOnEveryNotifyEvenWithinOneSecond(): void
    {
        $signal = new ChannelSignal(new AppPaths($this->dir, $this->dir, $this->dir), false);
        $before = $signal->fingerprint(['session:1', 'map:2']);
        $signal->notify(['session:1' => 10]);
        self::assertSame($this->dir . '/cache/ch/' . sha1('session:1'), $signal->file('session:1'));
        self::assertSame('10', file_get_contents($signal->file('session:1')));
        $one = $signal->fingerprint(['session:1', 'map:2']);
        self::assertNotSame($before, $one);
        $signal->notify(['session:1' => 11]);
        $two = $signal->fingerprint(['session:1', 'map:2']);
        self::assertNotSame($one, $two, 'same second, other id');
        self::assertSame($two, $signal->fingerprint(['session:1', 'map:2']), 'stable without a signal');
        $signal->notify(['map:2' => 12]);
        self::assertNotSame($two, $signal->fingerprint(['session:1', 'map:2']));
        self::assertSame($two, $signal->fingerprint(['session:1']) . '|-:', 'other channels do not matter');
    }

    public function testFailuresAreSilent(): void
    {
        file_put_contents($this->dir, 'not a directory');
        try {
            $signal = new ChannelSignal(new AppPaths($this->dir, $this->dir, $this->dir), false);
            $signal->notify(['session:1' => 1]);
            self::assertSame('-:', $signal->fingerprint(['session:1']));
        } finally {
            unlink($this->dir);
        }
    }

    public function testEvery(): void
    {
        $every = new Every(20.0);
        self::assertTrue($every->due(100.0));
        self::assertFalse($every->due(119.9));
        self::assertTrue($every->due(120.0));
        self::assertFalse($every->due(125.0));
    }
}
