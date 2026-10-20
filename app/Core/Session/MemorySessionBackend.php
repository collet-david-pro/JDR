<?php

declare(strict_types=1);

namespace JDR\Core\Session;

defined('JDR_BOOT') || exit;

/**
 * In-memory sessions (tests). The session cookie goes through the CookieJar.
 */
final class MemorySessionBackend implements SessionBackend
{
    /** @var array<string, array<string, mixed>> */
    private array $sessions = [];

    public function __construct(private CookieJar $cookies)
    {
    }

    public function start(SessionOptions $options, ?string $cookieId): array
    {
        if ($cookieId !== null && isset($this->sessions[$cookieId])) {
            return [$cookieId, $this->sessions[$cookieId]];
        }
        $id = self::newId();
        $this->sessions[$id] = [];
        $this->cookies->set($options->name, $id, 0, $options->path, $options->secure);

        return [$id, []];
    }

    public function commit(string $id, array $data): void
    {
        if (isset($this->sessions[$id])) {
            $this->sessions[$id] = $data;
        }
    }

    public function regenerate(SessionOptions $options, string $id, array $data): string
    {
        unset($this->sessions[$id]);
        $new = self::newId();
        $this->sessions[$new] = $data;
        $this->cookies->set($options->name, $new, 0, $options->path, $options->secure);

        return $new;
    }

    public function destroy(SessionOptions $options, string $id): void
    {
        unset($this->sessions[$id]);
        $this->cookies->set($options->name, '', 1, $options->path, $options->secure);
    }

    /**
     * Stored data of a session (tests).
     *
     * @return array<string, mixed>|null
     */
    public function peek(string $id): ?array
    {
        return $this->sessions[$id] ?? null;
    }

    /**
     * Number of live sessions (tests).
     */
    public function count(): int
    {
        return count($this->sessions);
    }

    private static function newId(): string
    {
        return bin2hex(random_bytes(20));
    }
}
