<?php

declare(strict_types=1);

namespace JDR\Core\Session;

defined('JDR_BOOT') || exit;

use JDR\Core\DbSessionHandler;

/**
 * PHP sessions: jdr_sid, use_strict_mode, use_only_cookies, HttpOnly, SameSite=Lax, Secure when
 * HTTPS. Files by default; DbSessionHandler (table php_sessions) when settings.use_db_sessions.
 * PHP itself sends the session cookie.
 */
final class NativeSessionBackend implements SessionBackend
{
    private bool $configured = false;
    private ?\SessionHandlerInterface $handler = null;

    /**
     * @param \Closure(): ?\SessionHandlerInterface $handlerFactory null = PHP files
     */
    public function __construct(private \Closure $handlerFactory)
    {
    }

    public function start(SessionOptions $options, ?string $cookieId): array
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return [(string) session_id(), $_SESSION];
        }
        $this->configure($options);
        if (!session_start()) {
            throw new \RuntimeException('Unable to start the session.');
        }
        /** @var array<string, mixed> $data */
        $data = is_array($_SESSION ?? null) ? $_SESSION : [];

        return [(string) session_id(), $data];
    }

    public function commit(string $id, array $data): void
    {
        if (session_status() !== PHP_SESSION_ACTIVE) {
            return;
        }
        $_SESSION = $data;
        if ($this->handler instanceof DbSessionHandler) {
            $uid = $data['uid'] ?? null;
            $this->handler->setUserId(is_int($uid) ? $uid : null);
        }
        session_write_close();
    }

    public function regenerate(SessionOptions $options, string $id, array $data): string
    {
        if (session_status() !== PHP_SESSION_ACTIVE) {
            $this->start($options, null);
        }
        $_SESSION = $data;
        session_regenerate_id(true);

        return (string) session_id();
    }

    public function destroy(SessionOptions $options, string $id): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            $_SESSION = [];
            session_destroy();
        }
        if (!headers_sent()) {
            setcookie($options->name, '', [
                'expires' => 1,
                'path' => $options->path,
                'secure' => $options->secure,
                'httponly' => true,
                'samesite' => 'Lax',
            ]);
        }
    }

    private function configure(SessionOptions $options): void
    {
        if ($this->configured) {
            return;
        }
        $this->configured = true;
        ini_set('session.use_strict_mode', '1');
        ini_set('session.use_only_cookies', '1');
        ini_set('session.use_cookies', '1');
        ini_set('session.use_trans_sid', '0');
        ini_set('session.cookie_httponly', '1');
        // Never let the garbage collector drop a session before the idle timeout.
        ini_set('session.gc_maxlifetime', (string) max(1440, $options->idleSeconds));
        session_name($options->name);
        session_cache_limiter('');
        session_set_cookie_params([
            'lifetime' => 0,
            'path' => $options->path,
            'secure' => $options->secure,
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        $this->handler = ($this->handlerFactory)();
        if ($this->handler !== null) {
            session_set_save_handler($this->handler, true);
        }
    }
}
