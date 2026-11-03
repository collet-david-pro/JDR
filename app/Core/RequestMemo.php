<?php

declare(strict_types=1);

namespace JDR\Core;

defined('JDR_BOOT') || exit;

/**
 * Request-scoped memo of repeated reads (SQL budget, P10e2a): assignments, fog, vision, notes
 * visibility... are needed by several services of one request. App::handle() opens the scope
 * (RequestMemo::scope(), static: no database needed to serve a page before installation);
 * outside it (cron, CLI, tests calling services directly) every read goes to the database.
 *
 * Invalidation: an entry names the tables it was read from; any write statement on one of
 * them in the request (Db::onChange) drops it. Reads inside a transaction are kept apart from
 * reads outside it and are forgotten at every transaction boundary (begin, commit, rollback),
 * so a locked read never reuses older data and a rolled back write never survives.
 */
final class RequestMemo
{
    /** @var array<string, array{tables: list<string>, value: mixed}> */
    private array $entries = [];
    /** Scope of the entries (a new request starts with an empty memo). */
    private int $seen = 0;
    private static int $depth = 0;
    private static int $generation = 0;

    public function __construct(private Db $db)
    {
        $db->onChange(function (string $kind, string $sql): void {
            if ($kind === Db::CHANGE_TX) {
                $this->forgetTransaction();
            } else {
                $this->written($sql);
            }
        });
    }

    /**
     * Runs $fn with the memo active (one HTTP request).
     *
     * @template T
     * @param \Closure(): T $fn
     * @return T
     */
    public static function scope(\Closure $fn): mixed
    {
        if (self::$depth === 0) {
            self::$generation++;
        }
        self::$depth++;
        try {
            return $fn();
        } finally {
            self::$depth--;
        }
    }

    private function active(): bool
    {
        if (self::$depth === 0) {
            return false;
        }
        if ($this->seen !== self::$generation) {
            $this->seen = self::$generation;
            $this->entries = [];
        }

        return true;
    }

    /**
     * The value of $key, loaded once per request (and per transaction).
     *
     * @template T
     * @param list<string> $tables unprefixed table names the value is read from
     * @param \Closure(): T $load
     * @return T
     */
    public function remember(string $key, array $tables, \Closure $load): mixed
    {
        if (!$this->active()) {
            return $load();
        }
        $key = $this->scoped($key);
        if (array_key_exists($key, $this->entries)) {
            return $this->entries[$key]['value'];
        }
        $value = $load();
        $this->entries[$key] = ['tables' => $this->quoted($tables), 'value' => $value];

        return $value;
    }

    /**
     * Stores a value read as a by-product of another query (no-op outside a request).
     *
     * @param list<string> $tables
     */
    public function prime(string $key, array $tables, mixed $value): void
    {
        if ($this->active()) {
            $this->entries[$this->scoped($key)] = ['tables' => $this->quoted($tables), 'value' => $value];
        }
    }

    private function scoped(string $key): string
    {
        return ($this->db->inTransaction() ? 't|' : 'n|') . $key;
    }

    /**
     * @param list<string> $tables
     * @return list<string>
     */
    private function quoted(array $tables): array
    {
        return array_map(fn (string $table): string => $this->db->t($table), $tables);
    }

    private function written(string $sql): void
    {
        foreach ($this->entries as $key => $entry) {
            foreach ($entry['tables'] as $table) {
                if (str_contains($sql, $table)) {
                    unset($this->entries[$key]);
                    break;
                }
            }
        }
    }

    private function forgetTransaction(): void
    {
        foreach (array_keys($this->entries) as $key) {
            if (str_starts_with($key, 't|')) {
                unset($this->entries[$key]);
            }
        }
    }
}
