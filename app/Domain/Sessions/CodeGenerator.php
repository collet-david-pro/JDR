<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions;

defined('JDR_BOOT') || exit;

/**
 * Session codes (projet.md 2.3, 11.5): 8 characters of ALPHABET (no 0/O/1/I), stored without
 * dash, shown as "K7F2-QM9X". Unique (5 tries).
 */
final class CodeGenerator
{
    public const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    public const LENGTH = 8;
    public const TRIES = 5;

    /**
     * @param callable(string): bool $exists true when the code is already used
     */
    public function generate(callable $exists): string
    {
        for ($i = 0; $i < self::TRIES; $i++) {
            $code = self::random();
            if (!$exists($code)) {
                return $code;
            }
        }
        throw new \RuntimeException('No free session code after ' . self::TRIES . ' tries.');
    }

    public static function random(): string
    {
        $max = strlen(self::ALPHABET) - 1;
        $code = '';
        for ($i = 0; $i < self::LENGTH; $i++) {
            $code .= self::ALPHABET[random_int(0, $max)];
        }

        return $code;
    }

    /**
     * Typed code => stored form (upper case, without dash or white space), or null when it is
     * not a valid code.
     */
    public static function normalize(mixed $input): ?string
    {
        if (!is_string($input)) {
            return null;
        }
        $code = strtoupper(preg_replace('/[\s\-]+/u', '', $input) ?? '');

        return preg_match('/^[' . self::ALPHABET . ']{' . self::LENGTH . '}$/D', $code) === 1 ? $code : null;
    }

    /**
     * Display form: "K7F2-QM9X".
     */
    public static function format(string $code): string
    {
        return substr($code, 0, 4) . '-' . substr($code, 4);
    }
}
