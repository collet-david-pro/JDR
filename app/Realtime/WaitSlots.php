<?php

declare(strict_types=1);

namespace JDR\Realtime;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Domain\Settings\Settings;

/**
 * Cap on the connections that keep a PHP worker busy (GET /stream, GET /events with wait > 0),
 * setting realtime_max_waiting (P10e2a). A slot is a MySQL named lock
 * GET_LOCK('<prefix>rt_slot_<n>', 0), n = 1..max, held by the request's connection for the whole
 * stream or wait: no table, no file, and MySQL frees it by itself when the process dies.
 * Without a free slot the client is told to fall back to short polling (POLL_SIGNAL).
 */
final class WaitSlots
{
    public const RETRY_AFTER_S = 120;
    public const POLL_SIGNAL = ['mode' => 'poll', 'retry_after_s' => self::RETRY_AFTER_S];

    /**
     * Slots held by this process (MySQL named locks are re-entrant within one connection).
     *
     * @var array<int, true>
     */
    private array $held = [];

    public function __construct(private Db $db, private Settings $settings)
    {
    }

    /**
     * Returns the configured maximum number of simultaneous waiting connections.
     */
    public function max(): int
    {
        return max(0, $this->settings->int('realtime_max_waiting'));
    }

    /**
     * Returns the lock name used for a slot (prefixed with the table prefix).
     */
    public function name(int $slot): string
    {
        return $this->db->prefix() . 'rt_slot_' . $slot;
    }

    /**
     * Takes the first free slot.
     *
     * @return int|null the slot number, null when every slot is taken (or the cap is 0)
     */
    public function acquire(): ?int
    {
        $max = $this->max();
        for ($slot = 1; $slot <= $max; $slot++) {
            if (isset($this->held[$slot])) {
                continue;
            }
            if ((int) $this->db->fetchValue('SELECT GET_LOCK(?, 0)', [$this->name($slot)]) === 1) {
                $this->held[$slot] = true;

                return $slot;
            }
        }

        return null;
    }

    /**
     * Releases the named database lock held for the slot.
     */
    public function release(int $slot): void
    {
        if (!isset($this->held[$slot])) {
            return;
        }
        unset($this->held[$slot]);
        try {
            $this->db->fetchValue('SELECT RELEASE_LOCK(?)', [$this->name($slot)]);
        } catch (\Throwable) {
            // The lock goes away with the connection anyway.
        }
    }

    /**
     * Runs $fn holding a slot, or $full when none is free; the slot is always given back.
     *
     * @template T
     * @param \Closure(): T $fn
     * @param \Closure(): T $full
     * @return T
     */
    public function run(\Closure $fn, \Closure $full): mixed
    {
        $slot = $this->acquire();
        if ($slot === null) {
            return $full();
        }
        try {
            return $fn();
        } finally {
            $this->release($slot);
        }
    }

    /**
     * Number of slots taken right now, by any process (admin diagnostic).
     */
    public function used(): int
    {
        $max = $this->max();
        if ($max === 0) {
            return 0;
        }
        $names = [];
        for ($slot = 1; $slot <= $max; $slot++) {
            $names[] = $this->name($slot);
        }
        $sum = implode(' + ', array_fill(0, $max, '(IS_USED_LOCK(?) IS NOT NULL)'));

        return (int) $this->db->fetchValue('SELECT ' . $sum, $names);
    }
}
