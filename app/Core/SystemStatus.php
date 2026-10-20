<?php

declare(strict_types=1);

namespace JDR\Core;

defined('JDR_BOOT') || exit;

/**
 * Database reachability, schema version and maintenance flag, read once per request.
 * Defensive: never throws. db() is "ok", "error" or "not_configured".
 */
final class SystemStatus
{
    public const DB_OK = 'ok';
    public const DB_ERROR = 'error';
    public const DB_NOT_CONFIGURED = 'not_configured';

    private bool $loaded = false;
    private string $db = self::DB_NOT_CONFIGURED;
    private ?string $dbVersion = null;
    private bool $maintenance = false;
    private bool $schemaMissing = false;

    /**
     * @param (\Closure(): Db)|null $dbFactory
     */
    private function __construct(private ?\Closure $dbFactory, private ?Logger $logger = null)
    {
    }

    public static function notConfigured(): self
    {
        $status = new self(null);
        $status->loaded = true;

        return $status;
    }

    /**
     * @param \Closure(): Db $dbFactory
     */
    public static function fromDb(\Closure $dbFactory, ?Logger $logger = null): self
    {
        return new self($dbFactory, $logger);
    }

    /**
     * Fixed values (tests).
     */
    public static function fixed(
        string $db,
        ?string $dbVersion,
        bool $maintenance = false,
        bool $schemaMissing = false,
    ): self {
        $status = new self(null);
        $status->loaded = true;
        $status->db = $db;
        $status->dbVersion = $dbVersion;
        $status->maintenance = $maintenance;
        $status->schemaMissing = $schemaMissing;

        return $status;
    }

    public function db(): string
    {
        $this->load();

        return $this->db;
    }

    public function dbVersion(): ?string
    {
        $this->load();

        return $this->dbVersion;
    }

    public function maintenance(): bool
    {
        $this->load();

        return $this->maintenance;
    }

    /**
     * True when the site must answer 503: maintenance flag, schema absent or behind the code.
     * An unreachable database does not trigger maintenance (routes needing it fail on their own).
     */
    public function needsMaintenance(string $requiredDbVersion): bool
    {
        $this->load();
        if ($this->schemaMissing) {
            return true;
        }
        if ($this->db !== self::DB_OK) {
            return false;
        }

        return $this->maintenance || self::isBehind($this->dbVersion, $requiredDbVersion);
    }

    public static function isBehind(?string $current, string $required): bool
    {
        if ($current === null || preg_match('/^\d+$/', $current) !== 1) {
            return true;
        }

        return (int) $current < (int) $required;
    }

    private function load(): void
    {
        if ($this->loaded) {
            return;
        }
        $this->loaded = true;
        if ($this->dbFactory === null) {
            return;
        }
        try {
            $db = ($this->dbFactory)();
            if (!$db->tableExists('settings')) {
                $this->db = self::DB_ERROR;
                $this->schemaMissing = true;

                return;
            }
            $rows = $db->fetchAll(
                'SELECT `key`, `value` FROM ' . $db->t('settings') . ' WHERE `key` IN (?, ?)',
                ['maintenance', 'db_version'],
            );
            foreach ($rows as $row) {
                $value = json_decode((string) $row['value'], true);
                if ($row['key'] === 'maintenance') {
                    $this->maintenance = $value === true || $value === 1 || $value === '1';
                } elseif ($row['key'] === 'db_version' && (is_string($value) || is_int($value))) {
                    $this->dbVersion = is_int($value) ? str_pad((string) $value, 4, '0', STR_PAD_LEFT) : $value;
                }
            }
            $this->db = self::DB_OK;
        } catch (\Throwable $e) {
            $this->db = self::DB_ERROR;
            $this->logger?->error('Database unavailable', Logger::exceptionContext($e));
        }
    }
}
