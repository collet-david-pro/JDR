<?php

declare(strict_types=1);

namespace JDR\Install;

defined('JDR_BOOT') || exit;

use JDR\Domain\Auth\Passwords;

/**
 * Validation of the installer forms. Each method returns [clean values, errors (field => code)].
 * Error codes are keys of the installer strings ("err.<code>").
 */
final class Validator
{
    public const PREFIX_PATTERN = '/^[a-z][a-z0-9_]{0,15}$/';
    public const USERNAME_PATTERN = '/^[\p{L}\p{N}_ .-]{3,40}$/u';
    public const REGISTRATION_MODES = ['open', 'closed', 'invite'];
    public const LOCALES = ['fr'];
    private const MB = 1024 * 1024;

    /**
     * @param array<string, mixed> $in
     * @return array{
     *     0: array{host:string,port:int,name:string,user:string,pass:string,prefix:string,create_db:bool},
     *     1: array<string, string>
     * }
     */
    public static function database(array $in): array
    {
        $errors = [];
        $host = trim(self::str($in, 'host'));
        $port = trim(self::str($in, 'port'));
        $name = trim(self::str($in, 'name'));
        $user = trim(self::str($in, 'user'));
        $pass = self::str($in, 'pass');
        $prefix = strtolower(trim(self::str($in, 'prefix')));

        if ($host === '') {
            $errors['host'] = 'required';
        } elseif (preg_match('/^(?:[A-Za-z0-9._-]{1,253}|\[[0-9a-fA-F:.]+\])$/', $host) !== 1) {
            $errors['host'] = 'invalid'; // host name, IPv4 or [IPv6]
        }
        if ($port === '') {
            $port = '3306';
        }
        if (preg_match('/^\d{1,5}$/', $port) !== 1 || (int) $port < 1 || (int) $port > 65535) {
            $errors['port'] = 'invalid';
        }
        if ($name === '') {
            $errors['name'] = 'required';
        } elseif (preg_match('/^[A-Za-z0-9_$-]{1,64}$/', $name) !== 1) {
            $errors['name'] = 'db_name';
        }
        if ($user === '') {
            $errors['user'] = 'required';
        } elseif (strlen($user) > 80 || str_contains($user, "\0")) {
            $errors['user'] = 'invalid';
        }
        if (strlen($pass) > 256 || str_contains($pass, "\0")) {
            $errors['pass'] = 'invalid';
        }
        if (preg_match(self::PREFIX_PATTERN, $prefix) !== 1) {
            $errors['prefix'] = 'prefix';
        }

        return [[
            'host' => $host,
            'port' => (int) $port,
            'name' => $name,
            'user' => $user,
            'pass' => $pass,
            'prefix' => $prefix,
            'create_db' => self::bool($in, 'create_db'),
        ], $errors];
    }

    /**
     * Quota and limits are typed in Mo / px by the user, stored in bytes / px.
     *
     * @param array<string, mixed> $in
     * @return array{0: array{site_name:string,base_url:string,default_locale:string,registration_mode:string,
     *     default_quota_bytes:int,max_upload_bytes:int,max_dimension_px:int,storage:string,storage_custom:string},
     *     1: array<string, string>}
     */
    public static function site(array $in): array
    {
        $errors = [];
        $siteName = trim((string) preg_replace('/\s+/u', ' ', self::str($in, 'site_name')));
        $baseUrl = rtrim(trim(self::str($in, 'base_url')), '/');
        $locale = self::str($in, 'default_locale');
        $mode = self::str($in, 'registration_mode');
        $storage = self::str($in, 'storage') === 'custom' ? 'custom' : 'default';
        $custom = trim(self::str($in, 'storage_custom'));

        $len = mb_strlen($siteName, 'UTF-8');
        if ($len === 0) {
            $errors['site_name'] = 'required';
        } elseif ($len > 80 || preg_match('/[\x00-\x1F\x7F<>]/u', $siteName) === 1) {
            $errors['site_name'] = 'invalid';
        }
        if (!self::isBaseUrl($baseUrl)) {
            $errors['base_url'] = 'base_url';
        }
        if (!in_array($locale, self::LOCALES, true)) {
            $errors['default_locale'] = 'invalid';
        }
        if (!in_array($mode, self::REGISTRATION_MODES, true)) {
            $errors['registration_mode'] = 'invalid';
        }
        $quota = self::intIn($in, 'default_quota_mb', 1, 1024 * 1024, $errors);
        $upload = self::intIn($in, 'max_upload_mb', 1, 512, $errors);
        $dimension = self::intIn($in, 'max_dimension_px', 256, 16384, $errors);
        if ($storage === 'custom' && ($custom === '' || !self::isAbsolutePath($custom))) {
            $errors['storage_custom'] = 'absolute_path';
        }

        return [[
            'site_name' => $siteName,
            'base_url' => $baseUrl,
            'default_locale' => $locale,
            'registration_mode' => $mode,
            'default_quota_bytes' => $quota * self::MB,
            'max_upload_bytes' => $upload * self::MB,
            'max_dimension_px' => $dimension,
            'storage' => $storage,
            'storage_custom' => $storage === 'custom' ? rtrim($custom, '/\\') : '',
        ], $errors];
    }

    /**
     * @param array<string, mixed> $in
     * @return array{0: array{email:string,username:string,password:string}, 1: array<string, string>}
     */
    public static function admin(array $in): array
    {
        $errors = [];
        $email = mb_strtolower(trim(self::str($in, 'email')), 'UTF-8');
        $username = trim(self::str($in, 'username'));
        $password = self::str($in, 'password');
        $confirm = self::str($in, 'password_confirm');

        if ($email === '') {
            $errors['email'] = 'required';
        } elseif (strlen($email) > 191 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            $errors['email'] = 'email';
        }
        if ($username === '') {
            $errors['username'] = 'required';
        } elseif (preg_match(self::USERNAME_PATTERN, $username) !== 1) {
            $errors['username'] = 'username';
        }
        if ($password === '') {
            $errors['password'] = 'required';
        } elseif (($policy = Passwords::policyError($password)) !== null) {
            $errors['password'] = $policy;
        } elseif (!hash_equals($password, $confirm)) {
            $errors['password_confirm'] = 'mismatch';
        }

        return [['email' => $email, 'username' => $username, 'password' => $password], $errors];
    }

    public static function isBaseUrl(string $url): bool
    {
        if (preg_match('#^https?://[^\s/?\#]+(/[^\s?\#]*)?$#i', $url) !== 1) {
            return false;
        }

        return filter_var($url, FILTER_VALIDATE_URL) !== false && strlen($url) <= 255;
    }

    public static function isAbsolutePath(string $path): bool
    {
        if (str_contains($path, "\0") || str_contains($path, '..')) {
            return false;
        }

        return str_starts_with($path, '/') || preg_match('#^[A-Za-z]:[\\\\/]#', $path) === 1;
    }

    /**
     * @param array<string, mixed>  $in
     * @param array<string, string> $errors
     */
    private static function intIn(array $in, string $key, int $min, int $max, array &$errors): int
    {
        $raw = trim(self::str($in, $key));
        if (preg_match('/^\d{1,9}$/', $raw) !== 1 || (int) $raw < $min || (int) $raw > $max) {
            $errors[$key] = 'range';

            return $min;
        }

        return (int) $raw;
    }

    /**
     * @param array<string, mixed> $in
     */
    private static function str(array $in, string $key): string
    {
        $v = $in[$key] ?? '';

        return is_string($v) ? $v : '';
    }

    /**
     * @param array<string, mixed> $in
     */
    private static function bool(array $in, string $key): bool
    {
        $v = $in[$key] ?? null;

        return $v === '1' || $v === 'on' || $v === true;
    }
}
