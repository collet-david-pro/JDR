<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions\Actions;

defined('JDR_BOOT') || exit;

use JDR\Maps\FogCodec;

/**
 * D9 (etapes P06): the bits of a fog block (projet.md 12.3: 128 x 128 sub-cells, 4 per cell,
 * row-major, most significant bit first) a player may explore = the sub-cells whose centre lies in
 * one of the disks (position of one of his tokens, vision.range + 1 cell). Pure.
 */
final class FogMask
{
    public const SUB = 4;
    private const SIDE = 128;
    private const ROW_BYTES = 16;

    /** @var array<int, int>|null byte value => number of bits set */
    private static ?array $popcount = null;

    /**
     * Mask (2 048 raw bytes) of block (cx, cy) for the disks [x, y, r] (cells).
     *
     * @param list<array{0: float, 1: float, 2: float}> $disks
     */
    public static function block(int $cx, int $cy, array $disks): string
    {
        $x0 = $cx * 32.0;
        $y0 = $cy * 32.0;
        $near = [];
        foreach ($disks as [$x, $y, $r]) {
            if ($x + $r < $x0 || $x - $r > $x0 + 32 || $y + $r < $y0 || $y - $r > $y0 + 32) {
                continue;
            }
            if (self::covers($x, $y, $r, $x0, $y0)) {
                return str_repeat("\xff", FogCodec::RAW_BYTES);
            }
            $near[] = [$x, $y, $r];
        }
        if ($near === []) {
            return FogCodec::blank();
        }
        $mask = FogCodec::blank();
        for ($row = 0; $row < self::SIDE; $row++) {
            $yc = $y0 + ($row + 0.5) / self::SUB;
            foreach ($near as [$x, $y, $r]) {
                $dy = $yc - $y;
                if (abs($dy) > $r) {
                    continue;
                }
                $dx = sqrt($r * $r - $dy * $dy);
                $from = max(0, (int) ceil(($x - $dx - $x0) * self::SUB - 0.5));
                $to = min(self::SIDE - 1, (int) floor(($x + $dx - $x0) * self::SUB - 0.5));
                if ($from <= $to) {
                    self::fill($mask, $row, $from, $to);
                }
            }
        }

        return $mask;
    }

    /**
     * Number of bits set in a raw bitmap.
     */
    public static function bits(string $raw): int
    {
        if (self::$popcount === null) {
            self::$popcount = [];
            for ($i = 0; $i < 256; $i++) {
                $n = 0;
                for ($v = $i; $v > 0; $v >>= 1) {
                    $n += $v & 1;
                }
                self::$popcount[$i] = $n;
            }
        }
        $total = 0;
        foreach (count_chars($raw, 1) as $byte => $count) {
            $total += self::$popcount[$byte] * $count;
        }

        return $total;
    }

    /**
     * Does the disk contain every sub-cell centre of the block?
     */
    private static function covers(float $x, float $y, float $r, float $x0, float $y0): bool
    {
        foreach ([[$x0, $y0], [$x0 + 32, $y0], [$x0, $y0 + 32], [$x0 + 32, $y0 + 32]] as [$px, $py]) {
            if (($px - $x) ** 2 + ($py - $y) ** 2 > $r * $r) {
                return false;
            }
        }

        return true;
    }

    /**
     * Sets the bits [from, to] of a row.
     */
    private static function fill(string &$mask, int $row, int $from, int $to): void
    {
        $base = $row * self::ROW_BYTES;
        $first = $from >> 3;
        $last = $to >> 3;
        for ($byte = $first; $byte <= $last; $byte++) {
            $lo = $byte === $first ? $from & 7 : 0;
            $hi = $byte === $last ? $to & 7 : 7;
            $bits = (0xff >> $lo) & (0xff << (7 - $hi)) & 0xff;
            $mask[$base + $byte] = chr(ord($mask[$base + $byte]) | $bits);
        }
    }
}
