<?php

declare(strict_types=1);

namespace JDR\Realtime;

defined('JDR_BOOT') || exit;

/**
 * Decides when a waiting loop reads MySQL (projet.md 10.4): when the witness of one of its
 * channels changed, plus a safety read every 5 s (a missed signal). Take the baseline with
 * start() BEFORE the first read, so that a signal arriving during that read is not lost.
 */
final class ChannelWatch
{
    public const SAFETY_S = 5.0;

    private string $fingerprint = '';
    private float $lastRead = 0.0;

    /**
     * @param list<string> $channels
     */
    public function __construct(
        private ChannelSignal $signal,
        private Timer $timer,
        private array $channels,
        private float $safetySeconds = self::SAFETY_S,
    ) {
    }

    public function start(): void
    {
        $this->fingerprint = $this->signal->fingerprint($this->channels);
        $this->lastRead = $this->timer->now();
    }

    /**
     * True when the loop should read now (the baseline and the safety clock are then reset).
     */
    public function shouldRead(): bool
    {
        $fingerprint = $this->signal->fingerprint($this->channels);
        $now = $this->timer->now();
        if ($fingerprint === $this->fingerprint && $now - $this->lastRead < $this->safetySeconds) {
            return false;
        }
        $this->fingerprint = $fingerprint;
        $this->lastRead = $now;

        return true;
    }
}
