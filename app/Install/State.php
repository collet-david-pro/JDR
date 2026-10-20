<?php

declare(strict_types=1);

namespace JDR\Install;

defined('JDR_BOOT') || exit;

/**
 * Wizard state between requests: a dedicated PHP session ("jdr_install") holding an AES-256-GCM
 * encrypted blob whose key lives only in a second HttpOnly cookie. The session file on the server
 * therefore never contains the database password nor the secrets in clear; the admin password is
 * only ever kept hashed.
 */
final class State
{
    public const SESSION_NAME = 'jdr_install';
    public const KEY_COOKIE = 'jdr_install_key';
    private const CIPHER = 'aes-256-gcm';

    /** @var array<string, mixed> */
    private array $data = [];
    private string $key = '';

    private function __construct(private bool $persistent)
    {
    }

    /**
     * Starts the session (production). Cookies: HttpOnly, SameSite=Lax, Secure on HTTPS.
     */
    public static function start(Env $env): self
    {
        $state = new self(true);
        $params = [
            'lifetime' => 0,
            'path' => ($env->basePath() === '' ? '' : $env->basePath()) . '/',
            'secure' => $env->isHttps(),
            'httponly' => true,
            'samesite' => 'Lax',
        ];
        ini_set('session.use_strict_mode', '1');
        ini_set('session.use_only_cookies', '1');
        ini_set('session.use_trans_sid', '0');
        session_name(self::SESSION_NAME);
        session_set_cookie_params($params);
        session_start();

        $key = $_COOKIE[self::KEY_COOKIE] ?? '';
        $raw = is_string($key) ? base64_decode(strtr($key, '-_', '+/'), true) : false;
        if ($raw === false || strlen($raw) !== 32) {
            $raw = random_bytes(32);
            setcookie(self::KEY_COOKIE, rtrim(strtr(base64_encode($raw), '+/', '-_'), '='), [
                'expires' => 0,
                'path' => $params['path'],
                'secure' => $params['secure'],
                'httponly' => true,
                'samesite' => 'Lax',
            ]);
            $_SESSION = [];
        }
        $state->key = $raw;
        $blob = $_SESSION['s'] ?? null;
        $state->data = is_string($blob) ? (self::decrypt($blob, $raw) ?? []) : [];

        return $state;
    }

    /**
     * In-memory state (tests).
     *
     * @param array<string, mixed> $data
     */
    public static function memory(array $data = []): self
    {
        $state = new self(false);
        $state->data = $data;
        $state->key = random_bytes(32);

        return $state;
    }

    public function get(string $key, mixed $default = null): mixed
    {
        return $this->data[$key] ?? $default;
    }

    public function set(string $key, mixed $value): void
    {
        $this->data[$key] = $value;
        $this->save();
    }

    public function remove(string $key): void
    {
        unset($this->data[$key]);
        $this->save();
    }

    /**
     * Form token of the installer (created on first use).
     */
    public function token(): string
    {
        $token = $this->data['token'] ?? null;
        if (!is_string($token) || strlen($token) !== 64) {
            $token = Secrets::token();
            $this->set('token', $token);
        }

        return $token;
    }

    public function checkToken(mixed $provided): bool
    {
        return is_string($provided) && $provided !== '' && hash_equals($this->token(), $provided);
    }

    /**
     * Forgets everything (end of installation).
     */
    public function clear(): void
    {
        $this->data = [];
        if ($this->persistent && session_status() === PHP_SESSION_ACTIVE) {
            $_SESSION = [];
            session_destroy();
        }
    }

    /**
     * Releases the session lock (before long HTTP probes, or when the page is done).
     */
    public function close(): void
    {
        if ($this->persistent && session_status() === PHP_SESSION_ACTIVE) {
            session_write_close();
        }
    }

    private function save(): void
    {
        if (!$this->persistent) {
            return;
        }
        if (session_status() !== PHP_SESSION_ACTIVE) {
            session_start();
        }
        $_SESSION['s'] = self::encrypt($this->data, $this->key);
    }

    /**
     * @param array<string, mixed> $data
     */
    public static function encrypt(array $data, string $key): string
    {
        $json = json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
        if (!function_exists('openssl_encrypt')) {
            return 'p:' . base64_encode($json); // openssl is a red requirement: never used in practice
        }
        $iv = random_bytes(12);
        $tag = '';
        $cipher = openssl_encrypt($json, self::CIPHER, $key, OPENSSL_RAW_DATA, $iv, $tag);
        if ($cipher === false) {
            throw new \RuntimeException('Encryption failed.');
        }

        return 'e:' . base64_encode($iv . $tag . $cipher);
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function decrypt(string $blob, string $key): ?array
    {
        $raw = base64_decode(substr($blob, 2), true);
        if ($raw === false) {
            return null;
        }
        if (str_starts_with($blob, 'p:')) {
            $json = $raw;
        } elseif (str_starts_with($blob, 'e:') && strlen($raw) > 28 && function_exists('openssl_decrypt')) {
            [$iv, $tag, $cipher] = [substr($raw, 0, 12), substr($raw, 12, 16), substr($raw, 28)];
            $json = openssl_decrypt($cipher, self::CIPHER, $key, OPENSSL_RAW_DATA, $iv, $tag);
            if ($json === false) {
                return null;
            }
        } else {
            return null;
        }
        $data = json_decode($json, true);

        return is_array($data) ? $data : null;
    }
}
