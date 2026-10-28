<?php

declare(strict_types=1);

namespace JDR\Domain\Update;

defined('JDR_BOOT') || exit;

/**
 * French strings of the update module (update.php must work while the site answers 503,
 * so they do not depend on i18n/). Placeholders: {name}.
 */
final class UpdateText
{
    /** @var array<string, string>|null */
    private static ?array $strings = null;

    /**
     * @param array<string, mixed> $params scalar values only are substituted
     */
    public static function t(string $key, array $params = []): string
    {
        self::$strings ??= require __DIR__ . '/strings.fr.php';
        $text = self::$strings[$key] ?? $key;
        $replace = [];
        foreach ($params as $name => $value) {
            if (is_scalar($value)) {
                $replace['{' . $name . '}'] = (string) $value;
            }
        }

        return $replace === [] ? $text : strtr($text, $replace);
    }

    public static function has(string $key): bool
    {
        self::$strings ??= require __DIR__ . '/strings.fr.php';

        return isset(self::$strings[$key]);
    }

    /**
     * Message of an error code ("update.not_newer" => strings "error.update.not_newer").
     *
     * @param array<string, mixed> $params
     */
    public static function error(string $code, array $params = []): string
    {
        $key = 'error.' . $code;

        return self::has($key) ? self::t($key, $params) : self::t('error.generic', ['code' => $code]);
    }
}
