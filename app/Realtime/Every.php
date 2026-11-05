<?php

declare(strict_types=1);

namespace JDR\Realtime;

defined('JDR_BOOT') || exit;

/**
 * Throttle for LoopListener implementations: due($now) is true at most once per interval
 * (true on the first call).
 */
final class Every
{
    private ?float $last = null;

    public function __construct(private float $seconds)
    {
    }

    /**
     * Returns true at most once per interval, recording the call time when it does.
     */
    public function due(float $now): bool
    {
        if ($this->last !== null && $now - $this->last < $this->seconds) {
            return false;
        }
        $this->last = $now;

        return true;
    }
}
