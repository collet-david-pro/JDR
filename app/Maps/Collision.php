<?php

declare(strict_types=1);

namespace JDR\Maps;

defined('JDR_BOOT') || exit;

/**
 * Server-side movement collision of a token (projet.md 10.5 point 2, etapes P06 D8). Pure.
 *
 * The obstacles of a floor are segments built like the "move" occluders of the client
 * (frontend/src/vision/occluders.ts):
 * - walls with blocks_move, cut where a door / window lies on them (nearly parallel, within
 *   max(thickness / 2, 0.05) + EPS of the wall);
 * - windows (always), closed doors, secret doors that are not revealed (even "open").
 * The move is the segment from the old centre to the new one, widened by the radius
 * r = 0.4 x min(size_w, size_h) x scale (a 1 x 1 token passes a 1-cell door: 0.4 < 0.5).
 * On a collision the token stops at the last valid point, moved back by RECOIL along the
 * segment. A token already closer than r to an obstacle (placed against a wall) may move as long
 * as it does not get closer to it.
 */
final class Collision
{
    public const EPS = 1e-4;
    public const MIN_THICKNESS = 0.05;
    public const RADIUS_FACTOR = 0.4;
    /** Distance moved back from the contact point, in cells. */
    public const RECOIL = 0.01;
    private const OPENING_MAX_SIN = 0.1;
    private const ITERATIONS = 60;

    public static function radius(float $sizeW, float $sizeH, float $scale): float
    {
        return self::RADIUS_FACTOR * min($sizeW, $sizeH) * $scale;
    }

    /**
     * Movement-blocking segments [ax, ay, bx, by] of the objects of one floor (API form).
     *
     * @param list<array<string, mixed>> $objects
     * @param array<string, true>        $revealed uids of the revealed objects
     * @return list<array{0: float, 1: float, 2: float, 3: float}>
     */
    public static function segments(array $objects, array $revealed): array
    {
        $openings = [];
        foreach ($objects as $o) {
            $type = $o['type'] ?? null;
            if ($type !== 'door' && $type !== 'window') {
                continue;
            }
            $props = $o['props'] ?? [];
            $blocks = $type === 'window'
                || (($props['secret'] ?? false) === true && !isset($revealed[(string) $o['uid']]))
                || ($props['state'] ?? 'closed') === 'closed';
            $openings[] = [
                (float) $o['geometry']['a'][0], (float) $o['geometry']['a'][1],
                (float) $o['geometry']['b'][0], (float) $o['geometry']['b'][1],
                $blocks,
            ];
        }
        $out = [];
        foreach ($objects as $o) {
            if (($o['type'] ?? null) !== 'wall' || ($o['props']['blocks_move'] ?? false) !== true) {
                continue;
            }
            $points = $o['geometry']['points'];
            $n = count($points);
            $count = ($o['geometry']['closed'] ?? false) === true && $n > 2 ? $n : $n - 1;
            $tol = max((float) $o['props']['thickness'] / 2, self::MIN_THICKNESS) + self::EPS;
            for ($i = 0; $i < $count; $i++) {
                $a = $points[$i];
                $b = $points[($i + 1) % $n];
                foreach (self::cut((float) $a[0], (float) $a[1], (float) $b[0], (float) $b[1], $tol, $openings) as $piece) {
                    $out[] = $piece;
                }
            }
        }
        foreach ($openings as [$ax, $ay, $bx, $by, $blocks]) {
            if ($blocks) {
                $out[] = [$ax, $ay, $bx, $by];
            }
        }

        return $out;
    }

    /**
     * Moves a disk of radius $r from P to Q against the segments.
     *
     * @param list<array{0: float, 1: float, 2: float, 3: float}> $segments
     * @return array{x: float, y: float, blocked: bool}
     */
    public static function move(array $segments, float $px, float $py, float $qx, float $qy, float $r): array
    {
        $dx = $qx - $px;
        $dy = $qy - $py;
        $len = hypot($dx, $dy);
        if ($len <= self::EPS) {
            return ['x' => $qx, 'y' => $qy, 'blocked' => false];
        }
        $minX = min($px, $qx) - $r - self::EPS;
        $maxX = max($px, $qx) + $r + self::EPS;
        $minY = min($py, $qy) - $r - self::EPS;
        $maxY = max($py, $qy) + $r + self::EPS;
        $hit = INF;
        foreach ($segments as [$ax, $ay, $bx, $by]) {
            if (max($ax, $bx) < $minX || min($ax, $bx) > $maxX || max($ay, $by) < $minY || min($ay, $by) > $maxY) {
                continue;
            }
            $t = self::hit($px, $py, $dx, $dy, $len, $ax, $ay, $bx, $by, $r);
            if ($t !== null && $t < $hit) {
                $hit = $t;
            }
        }
        if ($hit === INF) {
            return ['x' => $qx, 'y' => $qy, 'blocked' => false];
        }
        $t = max(0.0, $hit - self::RECOIL / $len);

        return ['x' => $px + $dx * $t, 'y' => $py + $dy * $t, 'blocked' => true];
    }

    /**
     * Distance from point (x, y) to segment A-B.
     */
    public static function distance(float $x, float $y, float $ax, float $ay, float $bx, float $by): float
    {
        $ex = $bx - $ax;
        $ey = $by - $ay;
        $l2 = $ex * $ex + $ey * $ey;
        $t = $l2 <= 0.0 ? 0.0 : max(0.0, min(1.0, (($x - $ax) * $ex + ($y - $ay) * $ey) / $l2));

        return hypot($x - ($ax + $t * $ex), $y - ($ay + $t * $ey));
    }

    /**
     * First parameter t in [0, 1] where the disk centred on P + tD gets closer to the segment
     * than allowed (r, or its starting distance when it starts closer), or null.
     */
    private static function hit(float $px, float $py, float $dx, float $dy, float $len, float $ax, float $ay, float $bx, float $by, float $r): ?float
    {
        $d0 = self::distance($px, $py, $ax, $ay, $bx, $by);
        if ($d0 <= self::EPS) {
            // Centre on the obstacle: only a real crossing of its line blocks.
            $t = self::cross($px, $py, $dx, $dy, $ax, $ay, $bx, $by);

            return $t !== null && $t * $len > self::EPS ? $t : null;
        }
        $limit = min($r, $d0) - 1e-9;
        $f = static fn (float $t): float => self::distance($px + $dx * $t, $py + $dy * $t, $ax, $ay, $bx, $by);
        // The distance is convex in t: find its minimum (ternary search) ...
        $lo = 0.0;
        $hi = 1.0;
        for ($i = 0; $i < self::ITERATIONS; $i++) {
            $m1 = $lo + ($hi - $lo) / 3;
            $m2 = $hi - ($hi - $lo) / 3;
            if ($f($m1) <= $f($m2)) {
                $hi = $m2;
            } else {
                $lo = $m1;
            }
        }
        $tMin = ($lo + $hi) / 2;
        if ($f($tMin) >= $limit) {
            return null;
        }
        // ... then the first t where it goes below the limit (bisection on [0, tMin]).
        $lo = 0.0;
        $hi = $tMin;
        for ($i = 0; $i < self::ITERATIONS; $i++) {
            $mid = ($lo + $hi) / 2;
            if ($f($mid) >= $limit) {
                $lo = $mid;
            } else {
                $hi = $mid;
            }
        }

        return $lo;
    }

    /**
     * Parameter t in [0, 1] where P + tD crosses segment C-E, or null.
     */
    private static function cross(float $px, float $py, float $dx, float $dy, float $cx, float $cy, float $ex, float $ey): ?float
    {
        $fx = $ex - $cx;
        $fy = $ey - $cy;
        $den = $dx * $fy - $dy * $fx;
        if (abs($den) <= 1e-12) {
            return null;
        }
        $wx = $cx - $px;
        $wy = $cy - $py;
        $t = ($wx * $fy - $wy * $fx) / $den;
        $u = ($wx * $dy - $wy * $dx) / $den;

        return $t >= 0.0 && $t <= 1.0 && $u >= -self::EPS && $u <= 1.0 + self::EPS ? $t : null;
    }

    /**
     * Parts of wall segment A-B not covered by the openings lying on it.
     *
     * @param list<array{0: float, 1: float, 2: float, 3: float, 4: bool}> $openings
     * @return list<array{0: float, 1: float, 2: float, 3: float}>
     */
    private static function cut(float $ax, float $ay, float $bx, float $by, float $tol, array $openings): array
    {
        $len = hypot($bx - $ax, $by - $ay);
        if ($len <= self::EPS) {
            return [];
        }
        $ux = ($bx - $ax) / $len;
        $uy = ($by - $ay) / $len;
        $cuts = [];
        foreach ($openings as [$oax, $oay, $obx, $oby]) {
            if (max($oax, $obx) < min($ax, $bx) - $tol || min($oax, $obx) > max($ax, $bx) + $tol
                || max($oay, $oby) < min($ay, $by) - $tol || min($oay, $oby) > max($ay, $by) + $tol) {
                continue;
            }
            $da = $ux * ($oay - $ay) - $uy * ($oax - $ax);
            $db = $ux * ($oby - $ay) - $uy * ($obx - $ax);
            $ol = hypot($obx - $oax, $oby - $oay);
            if (abs($da) > $tol || abs($db) > $tol || $ol <= self::EPS
                || abs($ux * ($oby - $oay) - $uy * ($obx - $oax)) / $ol > self::OPENING_MAX_SIN) {
                continue;
            }
            $ta = $ux * ($oax - $ax) + $uy * ($oay - $ay);
            $tb = $ux * ($obx - $ax) + $uy * ($oby - $ay);
            $lo = max(0.0, min($ta, $tb));
            $hi = min($len, max($ta, $tb));
            if ($hi - $lo > self::EPS) {
                $cuts[] = [$lo, $hi];
            }
        }
        $at = static fn (float $t): array => $t <= 0 ? [$ax, $ay] : ($t >= $len ? [$bx, $by] : [$ax + $ux * $t, $ay + $uy * $t]);
        if ($cuts === []) {
            return [[$ax, $ay, $bx, $by]];
        }
        usort($cuts, static fn (array $p, array $q): int => $p[0] <=> $q[0]);
        $out = [];
        $t0 = 0.0;
        foreach ($cuts as [$lo, $hi]) {
            if ($lo - $t0 > self::EPS) {
                $out[] = [...$at($t0), ...$at($lo)];
            }
            $t0 = max($t0, $hi);
        }
        if ($len - $t0 > self::EPS) {
            $out[] = [...$at($t0), $bx, $by];
        }

        return $out;
    }
}
