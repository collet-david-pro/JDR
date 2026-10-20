<?php

declare(strict_types=1);

namespace JDR\Core\Session;

defined('JDR_BOOT') || exit;

/**
 * Session of the current request (Request attribute "session"), started lazily:
 * - reading starts it only when the browser sent a session cookie;
 * - writing (set, csrfToken, regenerate) always starts it.
 * Handles the idle timeout (settings.session_idle_hours), the 7-day absolute lifetime and
 * the id regeneration every 30 minutes. Reserved keys start with "_".
 */
final class Session
{
    private ?string $id = null;

    /** @var array<string, mixed> */
    private array $data = [];

    private bool $started = false;
    private bool $closed = false;
    private ?SessionOptions $options = null;

    /**
     * @param \Closure(): SessionOptions $optionsFactory called on first start only
     */
    public function __construct(
        private SessionBackend $backend,
        private \Closure $optionsFactory,
        private ?string $cookieId,
        private int $now,
    ) {
        if ($this->cookieId !== null && preg_match('/^[A-Za-z0-9,-]{16,128}$/', $this->cookieId) !== 1) {
            $this->cookieId = null;
        }
    }

    public function hasCookie(): bool
    {
        return $this->cookieId !== null;
    }

    public function isStarted(): bool
    {
        return $this->started;
    }

    public function id(): ?string
    {
        return $this->id;
    }

    public function get(string $key, mixed $default = null): mixed
    {
        if (!$this->ensureStarted(false)) {
            return $default;
        }

        return array_key_exists($key, $this->data) ? $this->data[$key] : $default;
    }

    public function set(string $key, mixed $value): void
    {
        $this->assertWritable();
        $this->ensureStarted(true);
        $this->data[$key] = $value;
    }

    public function remove(string $key): void
    {
        if ($this->ensureStarted(false)) {
            $this->assertWritable();
            unset($this->data[$key]);
        }
    }

    /**
     * New session id, same data (login, role change, every 30 min).
     */
    public function regenerate(): void
    {
        $this->assertWritable();
        $this->ensureStarted(true);
        $this->id = $this->backend->regenerate($this->options(), (string) $this->id, $this->data);
        $this->data['_regen'] = $this->now;
    }

    /**
     * Deletes the session (logout, suspended account). A later write starts a fresh one.
     */
    public function destroy(): void
    {
        $this->assertWritable();
        if ($this->ensureStarted(false)) {
            $this->backend->destroy($this->options(), (string) $this->id);
        }
        $this->started = false;
        $this->cookieId = null;
        $this->id = null;
        $this->data = [];
    }

    /**
     * CSRF token of this session (32 random bytes, hex), created on first use.
     */
    public function csrfToken(): string
    {
        $token = $this->get('_csrf');
        if (is_string($token) && $token !== '') {
            return $token;
        }

        return $this->rotateCsrfToken();
    }

    public function rotateCsrfToken(): string
    {
        $token = bin2hex(random_bytes(32));
        $this->set('_csrf', $token);

        return $token;
    }

    /**
     * Writes the session and releases its lock now (long routes: SSE, long polling).
     * Data stays readable; any later write throws.
     */
    public function close(): void
    {
        if ($this->started && !$this->closed) {
            $this->backend->commit((string) $this->id, $this->data);
        }
        $this->closed = true;
    }

    public function isClosed(): bool
    {
        return $this->closed;
    }

    /**
     * End of request.
     */
    public function commit(): void
    {
        $this->close();
    }

    private function ensureStarted(bool $create): bool
    {
        if ($this->started) {
            return true;
        }
        if ($this->closed || (!$create && $this->cookieId === null)) {
            return false;
        }
        $options = $this->options();
        [$id, $data] = $this->backend->start($options, $this->cookieId);
        $this->started = true;
        $this->id = $id;
        $now = $this->now;
        $expired = $data !== [] && (
            $now - self::int($data['_last'] ?? 0) > $options->idleSeconds
            || $now - self::int($data['_created'] ?? 0) > $options->absoluteSeconds
        );
        if ($expired) {
            $data = [];
            $this->id = $this->backend->regenerate($options, $id, []);
        }
        if ($data === []) {
            $data = ['_created' => $now, '_regen' => $now];
        } elseif ($now - self::int($data['_regen'] ?? 0) > $options->regenerateSeconds) {
            $this->id = $this->backend->regenerate($options, $id, $data);
            $data['_regen'] = $now;
        }
        $data['_last'] = $now;
        $this->data = $data;

        return true;
    }

    private function options(): SessionOptions
    {
        return $this->options ??= ($this->optionsFactory)();
    }

    private function assertWritable(): void
    {
        if ($this->closed) {
            throw new \LogicException('The session is already closed.');
        }
    }

    private static function int(mixed $value): int
    {
        return is_int($value) ? $value : 0;
    }
}
