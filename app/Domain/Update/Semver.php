<?php

declare(strict_types=1);

namespace JDR\Domain\Update;

defined('JDR_BOOT') || exit;

/**
 * Semantic versions (semver 2.0): MAJOR.MINOR.PATCH[-pre.release][+build], optional leading "v".
 * Precedence: 1.0.0-alpha.1 < 1.0.0-alpha.2 < 1.0.0-beta.1 < 1.0.0; build metadata is ignored.
 */
final class Semver
{
    private const PATTERN = '/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)'
        . '(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/';

    /**
     * @return array{major:string,minor:string,patch:string,pre:list<string>,version:string}|null
     *     version = normalized form (no "v", no build metadata)
     */
    public static function parse(string $version): ?array
    {
        if (strlen($version) > 100 || preg_match(self::PATTERN, trim($version), $m) !== 1) {
            return null;
        }
        $pre = isset($m[4]) && $m[4] !== '' ? explode('.', $m[4]) : [];

        return [
            'major' => $m[1],
            'minor' => $m[2],
            'patch' => $m[3],
            'pre' => $pre,
            'version' => $m[1] . '.' . $m[2] . '.' . $m[3] . ($pre === [] ? '' : '-' . implode('.', $pre)),
        ];
    }

    public static function isValid(string $version): bool
    {
        return self::parse($version) !== null;
    }

    /**
     * Normalized version ("v1.2.3+abc" => "1.2.3"), or null when invalid.
     */
    public static function normalize(string $version): ?string
    {
        return self::parse($version)['version'] ?? null;
    }

    public static function isPrerelease(string $version): bool
    {
        $parsed = self::parse($version);

        return $parsed !== null && $parsed['pre'] !== [];
    }

    /**
     * -1, 0 or 1. An invalid version sorts before every valid one (two invalid ones are equal).
     */
    public static function compare(string $a, string $b): int
    {
        $pa = self::parse($a);
        $pb = self::parse($b);
        if ($pa === null || $pb === null) {
            return ($pa === null ? 0 : 1) <=> ($pb === null ? 0 : 1);
        }
        foreach (['major', 'minor', 'patch'] as $part) {
            $cmp = self::compareNumeric($pa[$part], $pb[$part]);
            if ($cmp !== 0) {
                return $cmp;
            }
        }
        if ($pa['pre'] === [] || $pb['pre'] === []) {
            // A version without pre-release ranks above any of its pre-releases.
            return ($pa['pre'] === [] ? 1 : 0) <=> ($pb['pre'] === [] ? 1 : 0);
        }
        $n = min(count($pa['pre']), count($pb['pre']));
        for ($i = 0; $i < $n; $i++) {
            $x = $pa['pre'][$i];
            $y = $pb['pre'][$i];
            $xNum = ctype_digit($x);
            $yNum = ctype_digit($y);
            if ($xNum && $yNum) {
                $cmp = self::compareNumeric($x, $y);
            } elseif ($xNum !== $yNum) {
                $cmp = $xNum ? -1 : 1; // numeric identifiers rank below alphanumeric ones
            } else {
                $cmp = strcmp($x, $y) <=> 0;
            }
            if ($cmp !== 0) {
                return $cmp;
            }
        }

        return count($pa['pre']) <=> count($pb['pre']);
    }

    public static function greaterThan(string $a, string $b): bool
    {
        return self::compare($a, $b) > 0;
    }

    /**
     * Numeric comparison of digit strings of any length (no integer overflow).
     */
    private static function compareNumeric(string $a, string $b): int
    {
        $a = ltrim($a, '0');
        $b = ltrim($b, '0');

        return strlen($a) !== strlen($b) ? strlen($a) <=> strlen($b) : strcmp($a, $b) <=> 0;
    }
}
