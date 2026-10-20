<?php

declare(strict_types=1);

namespace JDR\Install;

defined('JDR_BOOT') || exit;

/**
 * Installer strings (French). Self-contained on purpose: install.php must work before
 * anything else is configured. Placeholders: {name}.
 */
final class Strings
{
    /** @var array<string, string>|null */
    private static ?array $strings = null;

    /**
     * @param array<string, string|int|float> $params
     */
    public static function t(string $key, array $params = []): string
    {
        self::$strings ??= require __DIR__ . '/strings.fr.php';
        $text = self::$strings[$key] ?? $key;
        if ($params === []) {
            return $text;
        }
        $replace = [];
        foreach ($params as $name => $value) {
            $replace['{' . $name . '}'] = (string) $value;
        }

        return strtr($text, $replace);
    }

    public static function has(string $key): bool
    {
        self::$strings ??= require __DIR__ . '/strings.fr.php';

        return isset(self::$strings[$key]);
    }
}
