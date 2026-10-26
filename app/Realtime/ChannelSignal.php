<?php

declare(strict_types=1);

namespace JDR\Realtime;

defined('JDR_BOOT') || exit;

use JDR\Domain\Support\AppPaths;

/**
 * "New events" signal of a channel (projet.md 10.4), so that the waiting loops do not poll MySQL:
 * - writer, after COMMIT: the witness file storage/cache/ch/<sha1(channel)> is rewritten with the
 *   last event id (its mtime changes too), plus apcu_store("jdr:ch:<channel>", lastId) when APCu
 *   is available;
 * - reader: fingerprint() of its channels every 250 ms; a different fingerprint => read MySQL.
 * The file content is compared, not only filemtime(): mtime has a 1 s resolution and two events
 * in the same second would look identical. A lost signal only delays the reader until its
 * safety query (5 s). Every failure is silent (the signal is an optimisation, never a source).
 */
final class ChannelSignal
{
    private const APCU_PREFIX = 'jdr:ch:';

    private string $dir;
    private bool $apcu;

    public function __construct(AppPaths $paths, ?bool $useApcu = null)
    {
        $this->dir = rtrim($paths->storage, '/\\') . '/cache/ch';
        $this->apcu = $useApcu ?? self::apcuAvailable();
    }

    public static function apcuAvailable(): bool
    {
        return function_exists('apcu_enabled') && function_exists('apcu_store') && apcu_enabled();
    }

    public function directory(): string
    {
        return $this->dir;
    }

    public function file(string $channel): string
    {
        return $this->dir . '/' . sha1($channel);
    }

    /**
     * @param array<string, int> $lastIds channel => last committed event id
     */
    public function notify(array $lastIds): void
    {
        if ($lastIds === []) {
            return;
        }
        if (!is_dir($this->dir)) {
            @mkdir($this->dir, 0775, true);
        }
        foreach ($lastIds as $channel => $lastId) {
            $file = $this->file((string) $channel);
            if (@file_put_contents($file, (string) $lastId, LOCK_EX) === false) {
                @touch($file);
            }
            if ($this->apcu) {
                @apcu_store(self::APCU_PREFIX . $channel, $lastId);
            }
        }
    }

    /**
     * Opaque state of the witnesses of $channels: changes whenever one of them is signalled.
     *
     * @param list<string> $channels
     */
    public function fingerprint(array $channels): string
    {
        $parts = [];
        foreach ($channels as $channel) {
            $file = $this->file($channel);
            clearstatcache(true, $file);
            $mtime = @filemtime($file);
            $content = $mtime === false ? '' : (string) @file_get_contents($file, false, null, 0, 32);
            $part = ($mtime === false ? '-' : $mtime) . ':' . $content;
            if ($this->apcu) {
                $value = @apcu_fetch(self::APCU_PREFIX . $channel);
                $part .= ':' . (is_scalar($value) ? (string) $value : '-');
            }
            $parts[] = $part;
        }

        return implode('|', $parts);
    }
}
