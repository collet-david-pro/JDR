<?php

declare(strict_types=1);

namespace JDR\Maps;

defined('JDR_BOOT') || exit;

use JDR\Domain\Games\Fields;

/**
 * Free text label of a map (lot l17), called from ObjectRules; stateless.
 * - geometry {x, y}: anchor point (centre of the text) in cells, inside the map;
 * - props {text, size, color, font, rotation}: text 1-200 characters, single line, kept as plain text
 *   (never interpreted as HTML: clients draw it as a canvas / Pixi text); size = text height in cells
 *   [0.2, 10]; color "#rrggbb"; font in FONTS; rotation in degrees [-360, 360].
 * Layer "labels" and visibility "all" by default; the generic rules of the layer / visibility apply
 * (a gm layer or a gm / hidden visibility never reaches a player or a screen, see PlayerFilter).
 */
final class ObjectRulesText
{
    public const TYPE = 'text';
    public const TYPES = [self::TYPE];
    public const PROPS_KEYS = ['text', 'size', 'color', 'font', 'rotation'];
    public const FONTS = ['sans', 'serif', 'mono', 'hand'];
    public const TEXT_MAX = 200;
    public const SIZE_MIN = 0.2;
    public const SIZE_MAX = 10.0;

    /**
     * Tells whether the object type is the text type.
     */
    public static function handles(mixed $type): bool
    {
        return $type === self::TYPE;
    }

    /**
     * @param array<string, mixed>  $g
     * @param array<string, string> $errors
     * @return array{x: int|float, y: int|float}|null
     */
    public static function geometry(array $g, string $field, array &$errors, float $width, float $height): ?array
    {
        $x = ObjectRules::coordinate($g['x'], $field . '.x', $errors, $width);
        $y = ObjectRules::coordinate($g['y'], $field . '.y', $errors, $height);

        return $x === null || $y === null ? null : ['x' => $x, 'y' => $y];
    }

    /**
     * @param array<string, string> $errors
     * @return array{text: string, size: int|float, color: string, font: string, rotation: int|float}|null
     */
    public static function props(mixed $value, string $field, array &$errors): ?array
    {
        $p = Fields::object($value, self::PROPS_KEYS);
        if ($p === null) {
            $errors[$field] = 'invalid';

            return null;
        }
        $before = count($errors);
        foreach (self::PROPS_KEYS as $key) {
            if (!array_key_exists($key, $p)) {
                $errors[$field . '.' . $key] = 'required';
            }
        }
        if (count($errors) !== $before) {
            return null;
        }
        $text = Fields::text($p['text'], self::TEXT_MAX);
        if ($text === null) {
            $errors[$field . '.text'] = is_string($p['text']) && mb_strlen($p['text'], 'UTF-8') > self::TEXT_MAX ? 'too_large' : 'invalid';
        } elseif ($text === '') {
            $errors[$field . '.text'] = 'required';
        }
        $size = ObjectRules::number($p['size'], self::SIZE_MIN, self::SIZE_MAX, $field . '.size', $errors);
        $color = Fields::color($p['color']);
        if ($color === null) {
            $errors[$field . '.color'] = 'invalid';
        }
        if (!is_string($p['font']) || !in_array($p['font'], self::FONTS, true)) {
            $errors[$field . '.font'] = 'invalid';
        }
        $rotation = ObjectRules::number($p['rotation'], -360, 360, $field . '.rotation', $errors, 2);
        if (count($errors) !== $before || $text === null || $size === null || $color === null || $rotation === null) {
            return null;
        }

        return ['text' => $text, 'size' => $size, 'color' => $color, 'font' => (string) $p['font'], 'rotation' => $rotation];
    }

    /**
     * Rough bounding box (square of the text length around the anchor), bounded to the map.
     *
     * @param array<string, mixed> $object normalized
     * @return array{0: float, 1: float, 2: float, 3: float}
     */
    public static function bbox(array $object, float $width, float $height): array
    {
        $g = $object['geometry'];
        $p = $object['props'];
        $half = max(0.5, mb_strlen((string) $p['text'], 'UTF-8') * (float) $p['size'] * 0.3);
        $clamp = static fn (float $v, float $max): float => round(max(0.0, min($max, $v)), 3);

        return [$clamp((float) $g['x'] - $half, $width), $clamp((float) $g['y'] - $half, $height), $clamp((float) $g['x'] + $half, $width), $clamp((float) $g['y'] + $half, $height)];
    }
}
