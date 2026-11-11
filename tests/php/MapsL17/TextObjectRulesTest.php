<?php

declare(strict_types=1);

namespace JDR\Tests\MapsL17;

use JDR\Domain\Maps\Map;
use JDR\Maps\ObjectRules;
use JDR\Maps\PlayerFilter;
use PHPUnit\Framework\TestCase;

/**
 * Lot l17: text labels of a map (rules, bounds, plain text) and what players may receive.
 */
final class TextObjectRulesTest extends TestCase
{
    /**
     * @param array<string, mixed> $over
     * @return array<string, mixed>
     */
    private static function text(string $uid, array $over = []): array
    {
        return array_replace_recursive([
            'uid' => $uid, 'floor' => '1', 'type' => 'text', 'layer' => 'labels',
            'geometry' => ['x' => 3, 'y' => 4.5],
            'props' => ['text' => 'Salle du trone', 'size' => 0.6, 'color' => '#AA0000', 'font' => 'serif', 'rotation' => 15],
            'visibility' => 'all', 'locked' => false, 'sort_order' => 0,
        ], $over);
    }

    /**
     * @param array<string, mixed> $object
     * @return array{0: array<string, mixed>|null, 1: array<string, string>}
     */
    private static function check(array $object): array
    {
        $errors = [];
        $out = ObjectRules::object($object, 'object', $errors, 20.0, 15.0, static fn (mixed $f): ?string => is_string($f) ? $f : null, false);

        return [$out, $errors];
    }

    public function testValidTextIsNormalized(): void
    {
        [$out, $errors] = self::check(self::text('t1'));
        self::assertSame([], $errors);
        self::assertSame('#aa0000', $out['props']['color']);
        self::assertSame('labels', $out['layer']);
        self::assertSame(['text', 'size', 'color', 'font', 'rotation'], array_keys($out['props']));
    }

    public function testMarkupIsKeptAsPlainText(): void
    {
        [$out, $errors] = self::check(self::text('t1', ['props' => ['text' => '<img src=x onerror=alert(1)>']]));
        self::assertSame([], $errors);
        self::assertSame('<img src=x onerror=alert(1)>', $out['props']['text'], 'stored verbatim, drawn as canvas text only');
    }

    public function testInvalidValuesAreRefused(): void
    {
        $cases = [
            'props.text' => ['text' => ''],
            'props.size' => ['size' => 11],
            'props.color' => ['color' => 'red'],
            'props.font' => ['font' => 'comic'],
            'props.rotation' => ['rotation' => 400],
        ];
        foreach ($cases as $field => $props) {
            [$out, $errors] = self::check(self::text('t1', ['props' => $props]));
            self::assertNull($out, $field);
            self::assertArrayHasKey('object.' . $field, $errors, $field);
        }
        [, $errors] = self::check(self::text('t1', ['props' => ['text' => str_repeat('a', 201)]]));
        self::assertSame('too_large', $errors['object.props.text']);
        [, $errors] = self::check(self::text('t1', ['props' => ['text' => "a\nb"]]));
        self::assertSame('invalid', $errors['object.props.text']);
        [, $errors] = self::check(self::text('t1', ['geometry' => ['x' => 21]]));
        self::assertArrayHasKey('object.geometry.x', $errors);
        $o = self::text('t1');
        unset($o['props']['font']);
        [, $errors] = self::check($o);
        self::assertSame('required', $errors['object.props.font']);
    }

    public function testBoundingBoxStaysInTheMap(): void
    {
        [$out] = self::check(self::text('t1', ['geometry' => ['x' => 0.2, 'y' => 15]]));
        [$x1, $y1, $x2, $y2] = ObjectRules::bbox($out, 20.0, 15.0);
        self::assertGreaterThanOrEqual(0.0, $x1);
        self::assertLessThanOrEqual(15.0, $y2);
        self::assertLessThan($x2, $x1);
        self::assertLessThan($y2, $y1);
    }

    public function testGmTextsNeverReachPlayers(): void
    {
        $objects = [
            self::text('shown'),
            self::text('gmvis', ['visibility' => 'gm', 'props' => ['text' => 'SECRET-VIS']]),
            self::text('gmlayer', ['layer' => 'gm', 'props' => ['text' => 'SECRET-LAYER']]),
            self::text('hidden', ['visibility' => 'hidden_until_revealed', 'props' => ['text' => 'SECRET-HIDDEN']]),
        ];
        $seen = PlayerFilter::objects($objects);
        self::assertSame(['shown'], array_column($seen, 'uid'));
        self::assertStringNotContainsString('SECRET', (string) json_encode($seen));
        self::assertSame(['shown', 'hidden'], array_column(PlayerFilter::objects($objects, ['hidden']), 'uid'));
    }

    public function testGridThemesAreAccepted(): void
    {
        foreach (['parchment', 'slate', 'blueprint', 'dark', 'light', 'dots', 'crosses', 'major5', 'ink', 'glow'] as $theme) {
            self::assertContains($theme, Map::THEMES);
        }
    }
}
