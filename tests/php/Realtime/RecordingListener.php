<?php

declare(strict_types=1);

namespace JDR\Tests\Realtime;

use JDR\Realtime\LoopListener;
use JDR\Realtime\Subscription;

final class RecordingListener implements LoopListener
{
    /** @var list<float> */
    public array $ticks = [];
    public ?Subscription $last = null;
    public bool $throw = false;

    public function onLoopTick(Subscription $sub, float $now): void
    {
        $this->ticks[] = $now;
        $this->last = $sub;
        if ($this->throw) {
            throw new \RuntimeException('listener failure');
        }
    }
}
