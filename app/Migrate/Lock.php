<?php

declare(strict_types=1);

namespace JDR\Migrate;

use JDR\Core\Db;

defined('JDR_BOOT') || exit;

/**
 * Named MySQL lock (GET_LOCK, non-blocking) guarding migration runs.
 *
 * The lock name includes the table prefix and the database name so that
 * several installations sharing one server or one database do not block
 * each other. MySQL limits lock names to 64 characters.
 */
final class Lock
{
    private bool $held = false;

    public function __construct(private readonly Db $db, private readonly string $base = 'jdr_migrate')
    {
    }

    public function name(): string
    {
        $schema = (string) $this->db->fetchValue('SELECT DATABASE()');
        $name = $this->base . ':' . $this->db->prefix() . '@' . $schema;
        if (strlen($name) > 64) {
            $name = $this->base . ':' . $this->db->prefix() . '@' . substr(sha1($schema), 0, 16);
        }

        return $name;
    }

    /**
     * Tries to take the lock without waiting.
     */
    public function acquire(): bool
    {
        if ($this->held) {
            return true;
        }
        $this->held = (int) $this->db->fetchValue('SELECT GET_LOCK(?, 0)', [$this->name()]) === 1;

        return $this->held;
    }

    public function release(): void
    {
        if ($this->held) {
            $this->db->fetchValue('SELECT RELEASE_LOCK(?)', [$this->name()]);
            $this->held = false;
        }
    }

    public function isHeld(): bool
    {
        return $this->held;
    }
}
