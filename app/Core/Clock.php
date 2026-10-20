<?php

declare(strict_types=1);

namespace JDR\Core;

defined('JDR_BOOT') || exit;

/**
 * UTC clock. Can be frozen for tests.
 */
final class Clock
{
    private ?\DateTimeImmutable $fixed;

    public function __construct(?\DateTimeImmutable $fixed = null)
    {
        $this->fixed = $fixed?->setTimezone(new \DateTimeZone('UTC'));
    }

    public static function at(string $time): self
    {
        return new self(new \DateTimeImmutable($time, new \DateTimeZone('UTC')));
    }

    public function now(): \DateTimeImmutable
    {
        return $this->fixed ?? new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
    }

    public function timestamp(): int
    {
        return $this->now()->getTimestamp();
    }

    /**
     * DATETIME value for MySQL (UTC).
     */
    public function sql(): string
    {
        return $this->now()->format('Y-m-d H:i:s');
    }

    /**
     * ISO-8601 with milliseconds, for logs and JSON.
     */
    public function iso(): string
    {
        return $this->now()->format('Y-m-d\TH:i:s.v\Z');
    }
}
