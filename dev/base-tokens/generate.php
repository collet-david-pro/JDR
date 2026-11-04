<?php

declare(strict_types=1);

/**
 * Generates the 40 base tokens (round, top view) into app/Seed/base-pack/ and writes tokens.json
 * (pack.json belongs to the tile generator of the front: npm test with UPDATE_BASE_PACK=1).
 * PHP + GD only, fixed seed: two runs give the same pixels.
 *
 *   php dev/base-tokens/generate.php [--sheet /path/sheet.png]   (contact sheet, optional, outside the repo)
 */

const SS = 2; // supersampling factor

$root = dirname(__DIR__, 2);
$packDir = $root . '/app/Seed/base-pack';

final class G
{
    /** @var array<string, int> */
    private array $cache = [];
    public \GdImage $im;
    public float $u; // pixels per unit
    public float $cx;
    public float $cy;

    public function __construct(int $n, float $u)
    {
        $this->im = imagecreatetruecolor($n, $n);
        imagealphablending($this->im, true);
        imagesavealpha($this->im, true);
        imagefill($this->im, 0, 0, imagecolorallocatealpha($this->im, 0, 0, 0, 127));
        $this->u = $u;
        $this->cx = $this->cy = $n / 2;
    }

    public function col(string $hex, int $alpha = 0): int
    {
        $k = $hex . '/' . $alpha;
        if (!isset($this->cache[$k])) {
            $h = ltrim($hex, '#');
            $this->cache[$k] = imagecolorallocatealpha($this->im, hexdec(substr($h, 0, 2)), hexdec(substr($h, 2, 2)), hexdec(substr($h, 4, 2)), $alpha);
        }

        return $this->cache[$k];
    }

    public static function shade(string $hex, float $f): string
    {
        $h = ltrim($hex, '#');
        $o = '#';
        foreach ([0, 2, 4] as $i) {
            $v = hexdec(substr($h, $i, 2));
            $v = $f < 0 ? $v * (1 + $f) : $v + (255 - $v) * $f;
            $o .= sprintf('%02x', max(0, min(255, (int) round($v))));
        }

        return $o;
    }

    private function X(float $x): float
    {
        return $this->cx + $x * $this->u;
    }

    private function Y(float $y): float
    {
        return $this->cy + $y * $this->u;
    }

    public const OUT = '#1b1b22';
    public float $o = 0.045;

    /** Ellipse with outline. */
    public function e(float $x, float $y, float $rx, float $ry, string $fill, bool $outline = true): void
    {
        if ($outline) {
            imagefilledellipse($this->im, (int) $this->X($x), (int) $this->Y($y), (int) (2 * ($rx + $this->o) * $this->u), (int) (2 * ($ry + $this->o) * $this->u), $this->col(self::OUT));
        }
        imagefilledellipse($this->im, (int) $this->X($x), (int) $this->Y($y), (int) (2 * $rx * $this->u), (int) (2 * $ry * $this->u), $this->col($fill));
    }

    public function c(float $x, float $y, float $r, string $fill, bool $outline = true): void
    {
        $this->e($x, $y, $r, $r, $fill, $outline);
    }

    /** @param list<array{0: float, 1: float}> $pts */
    public function p(array $pts, string $fill, bool $outline = true): void
    {
        $flat = [];
        foreach ($pts as [$x, $y]) {
            $flat[] = (int) $this->X($x);
            $flat[] = (int) $this->Y($y);
        }
        if ($outline) {
            imagesetthickness($this->im, max(1, (int) (2 * $this->o * $this->u)));
            imagepolygon($this->im, $flat, $this->col(self::OUT));
            imagesetthickness($this->im, 1);
        }
        imagefilledpolygon($this->im, $flat, $this->col($fill));
    }

    public function l(float $x1, float $y1, float $x2, float $y2, float $w, string $fill, bool $outline = true): void
    {
        imagesetthickness($this->im, max(1, (int) (($w + ($outline ? 2 * $this->o : 0)) * $this->u)));
        if ($outline) {
            imageline($this->im, (int) $this->X($x1), (int) $this->Y($y1), (int) $this->X($x2), (int) $this->Y($y2), $this->col(self::OUT));
        }
        imagesetthickness($this->im, max(1, (int) ($w * $this->u)));
        imageline($this->im, (int) $this->X($x1), (int) $this->Y($y1), (int) $this->X($x2), (int) $this->Y($y2), $this->col($fill));
        imagesetthickness($this->im, 1);
    }

    /** Polyline (smooth curve given as points). @param list<array{0: float, 1: float}> $pts */
    public function pl(array $pts, float $w, string $fill, bool $outline = true): void
    {
        for ($i = 0; $i + 1 < count($pts); $i++) {
            if ($outline) {
                $this->l($pts[$i][0], $pts[$i][1], $pts[$i + 1][0], $pts[$i + 1][1], $w, self::OUT, false);
            }
        }
        // outline pass first (wider), then fill pass
        for ($i = 0; $i + 1 < count($pts); $i++) {
            if ($outline) {
                $this->l($pts[$i][0], $pts[$i][1], $pts[$i + 1][0], $pts[$i + 1][1], $w + 2 * $this->o, self::OUT, false);
            }
        }
        for ($i = 0; $i + 1 < count($pts); $i++) {
            $this->l($pts[$i][0], $pts[$i][1], $pts[$i + 1][0], $pts[$i + 1][1], $w, $fill, false);
            $this->c($pts[$i + 1][0], $pts[$i + 1][1], $w / 2, $fill, false);
        }
    }
}

// ---------------------------------------------------------------- drawing kit

/** Humanoid seen from above, facing up. */
function human(G $g, array $o): void
{
    $o += ['body' => '#6b7280', 'skin' => '#e8b98f', 'hair' => null, 'gear' => null, 'gearCol' => '#9ca3af', 'weapon' => null, 'shield' => null, 'w' => 1.0, 'ears' => false, 'cape' => null, 'pack' => null, 'handsFwd' => false, 'tusks' => false, 'beard' => null, 'apron' => null, 'trim' => null];
    $w = $o['w'];
    $g->cy += 0.12 * $g->u;
    if ($o['cape']) {
        $g->e(0, 0.3, 0.6 * $w, 0.5, $o['cape']);
    }
    if ($o['pack']) {
        $g->e(0, 0.42, 0.34 * $w, 0.3, $o['pack']);
    }
    $hy = $o['handsFwd'] ? -0.62 : -0.22;
    foreach ([-1, 1] as $s) {
        $g->l($s * 0.48 * $w, 0.1, $s * 0.64 * $w, $hy, 0.2, $o['body']);
    }
    // weapon behind the body shapes
    $rx = 0.64 * $w;
    switch ($o['weapon']) {
        case 'sword':
            $g->l($rx, $hy, $rx, -0.98, 0.1, '#e5e7eb');
            $g->l($rx - 0.15, $hy - 0.08, $rx + 0.15, $hy - 0.08, 0.07, '#d4a017');
            break;
        case 'dagger':
            $g->l($rx, $hy, $rx, -0.68, 0.08, '#e5e7eb');
            $g->l($rx - 0.1, $hy - 0.05, $rx + 0.1, $hy - 0.05, 0.06, '#8b5a2b');
            break;
        case 'staff':
            $g->l($rx, 0.55, $rx, -0.85, 0.07, '#8b5a2b');
            $g->c($rx, -0.9, 0.14, $o['gearCol'] === '#9ca3af' ? '#60a5fa' : $o['gearCol']);
            break;
        case 'mace':
            $g->l($rx, $hy + 0.1, $rx, -0.7, 0.07, '#8b5a2b');
            $g->c($rx, -0.78, 0.16, '#9ca3af');
            break;
        case 'axe':
            $g->l($rx, $hy + 0.15, $rx, -0.8, 0.07, '#8b5a2b');
            $g->p([[$rx, -0.9], [$rx + 0.32, -0.98], [$rx + 0.32, -0.45], [$rx, -0.55]], '#cbd5e1');
            break;
        case 'club':
            $g->l($rx, $hy + 0.15, $rx + 0.05, -0.85, 0.2, '#8b5a2b');
            $g->c($rx + 0.05, -0.9, 0.24, '#a16a35');
            break;
        case 'spear':
            $g->l($rx, 0.6, $rx, -0.85, 0.06, '#8b5a2b');
            $g->p([[$rx, -1.05], [$rx + 0.1, -0.82], [$rx - 0.1, -0.82]], '#e5e7eb');
            break;
        case 'fork':
            $g->l($rx, 0.6, $rx, -0.7, 0.06, '#8b5a2b');
            foreach ([-0.1, 0, 0.1] as $d) {
                $g->l($rx + $d, -0.7, $rx + $d, -0.95, 0.04, '#9ca3af', false);
            }
            break;
        case 'hammer':
            $g->l($rx, $hy + 0.1, $rx, -0.72, 0.07, '#8b5a2b');
            $g->p([[$rx - 0.2, -0.95], [$rx + 0.2, -0.95], [$rx + 0.2, -0.6], [$rx - 0.2, -0.6]], '#6b7280');
            break;
        case 'bow':
            $pts = [];
            for ($t = -1.0; $t <= 1.001; $t += 0.25) {
                $pts[] = [$rx + 0.28 * (1 - $t * $t), -0.35 + $t * 0.7];
            }
            $g->pl($pts, 0.07, '#8b5a2b');
            $g->l($rx, -1.05, $rx, 0.35, 0.02, '#f3f4f6', false);
            break;
        case 'lute':
            $g->e($rx - 0.05, -0.1, 0.22, 0.3, '#b9722f');
            $g->c($rx - 0.05, -0.1, 0.07, '#3b2412');
            $g->l($rx - 0.05, -0.35, $rx - 0.05, -0.9, 0.06, '#6b3f1d');
            break;
        case 'book':
            $g->p([[$rx - 0.2, -0.05], [$rx + 0.2, -0.05], [$rx + 0.2, -0.55], [$rx - 0.2, -0.55]], '#7c2d12');
            $g->l($rx, -0.05, $rx, -0.55, 0.03, '#fcd34d', false);
            break;
        case 'mug':
            $g->c($rx, $hy - 0.08, 0.14, '#d4a017');
            $g->c($rx, $hy - 0.08, 0.09, '#fef3c7', false);
            break;
        case 'bowl':
            $g->c($rx, $hy - 0.08, 0.16, '#8b5a2b');
            $g->c($rx, $hy - 0.08, 0.09, '#3b2412', false);
            break;
    }
    // shoulders
    $g->e(0, 0.12, 0.66 * $w, 0.42, $o['body']);
    if ($o['apron']) {
        $g->e(0, 0.2, 0.3 * $w, 0.22, $o['apron'], false);
    }
    if ($o['trim']) {
        $g->l(-0.5 * $w, 0.12, 0.5 * $w, 0.12, 0.07, $o['trim'], false);
    }
    foreach ([-1, 1] as $s) {
        $g->c($s * 0.64 * $w, $hy, 0.12, $o['skin']);
    }
    if ($o['shield']) {
        [$col, $sym] = $o['shield'];
        $g->c(-0.62 * $w, -0.2, 0.34, $col);
        $g->c(-0.62 * $w, -0.2, 0.08, '#e5e7eb');
        if ($sym === 'cross') {
            $g->l(-0.62 * $w, -0.42, -0.62 * $w, 0.02, 0.07, '#fde68a', false);
            $g->l(-0.62 * $w - 0.2, -0.2, -0.62 * $w + 0.2, -0.2, 0.07, '#fde68a', false);
        }
    }
    // head
    $g->c(0, -0.04, 0.34, $o['skin']);
    if ($o['ears']) {
        foreach ([-1, 1] as $s) {
            $g->p([[$s * 0.26, -0.1], [$s * 0.62, -0.28], [$s * 0.3, 0.08]], $o['skin']);
        }
        $g->c(0, -0.02, 0.3, $o['skin']);
    }
    if ($o['tusks']) {
        foreach ([-1, 1] as $s) {
            $g->p([[$s * 0.1, -0.22], [$s * 0.17, -0.4], [$s * 0.04, -0.28]], '#f5f0dc');
        }
    }
    $hair = $o['hair'];
    if ($hair !== null) {
        $g->c(0, 0.0, 0.3, $hair);
        $g->e(0, -0.17, 0.2, 0.12, $o['skin'], false);
    }
    if ($o['beard']) {
        $g->e(0, -0.2, 0.2, 0.1, $o['beard'], false);
    }
    switch ($o['gear']) {
        case 'helm':
            $g->c(0, -0.02, 0.32, $o['gearCol']);
            $g->l(0, -0.32, 0, 0.3, 0.1, '#dc2626', false);
            $g->l(-0.2, -0.2, 0.2, -0.2, 0.05, '#1b1b22', false);
            break;
        case 'hood':
            $g->c(0, -0.02, 0.34, $o['gearCol']);
            $g->e(0, -0.1, 0.18, 0.15, '#241c24', false);
            break;
        case 'hat':
            $g->c(0, 0, 0.62, $o['gearCol']);
            $g->c(0, 0, 0.3, G::shade($o['gearCol'], -0.25));
            $g->c(-0.05, -0.05, 0.14, G::shade($o['gearCol'], 0.35), false);
            $g->c(0, 0, 0.31, G::shade($o['gearCol'], -0.45), false);
            $g->c(0, 0, 0.26, G::shade($o['gearCol'], -0.1), false);
            $g->c(-0.06, -0.06, 0.1, G::shade($o['gearCol'], 0.3), false);
            break;
        case 'straw':
            $g->c(0, 0, 0.55, '#e5c76b');
            $g->c(0, 0, 0.22, '#c9a43c', false);
            break;
        case 'cap':
            $g->c(0, -0.02, 0.32, $o['gearCol']);
            $g->e(0, -0.28, 0.22, 0.09, G::shade($o['gearCol'], -0.3), false);
            break;
        case 'crown':
            $g->c(0, -0.02, 0.35, '#d4a017');
            $g->c(0, -0.02, 0.24, $hair ?? '#4b2e1e', false);
            foreach ([0, 1, 2, 3, 4, 5] as $i) {
                $a = $i * M_PI / 3;
                $g->c(0.35 * cos($a), -0.02 + 0.35 * sin($a), 0.06, '#fde68a', false);
            }
            break;
        case 'feather':
            $g->c(0, -0.02, 0.33, $o['gearCol']);
            $g->p([[0.1, 0.1], [0.5, -0.5], [0.58, -0.38], [0.2, 0.2]], '#f43f5e');
            break;
        case 'tonsure':
            $g->c(0, -0.02, 0.3, '#6b4423');
            $g->c(0, -0.02, 0.17, $o['skin'], false);
            break;
        case 'horns':
            foreach ([-1, 1] as $s) {
                $g->p([[$s * 0.18, -0.2], [$s * 0.34, -0.55], [$s * 0.3, -0.18]], '#f5f0dc');
            }
            break;
    }
}

/** Four-legged animal seen from above, facing up. */
function beast(G $g, array $o): void
{
    $o += ['fur' => '#8b6b4a', 'belly' => null, 'ear' => 'point', 'snout' => 0.2, 'tail' => 'short', 'tuskCol' => null, 'stripe' => null, 'mane' => null, 'antlers' => false, 'len' => 0.55, 'wid' => 0.34, 'dark' => null];
    $f = $o['fur'];
    $dk = $o['dark'] ?? G::shade($f, -0.35);
    $L = $o['len'];
    $W = $o['wid'];
    // tail
    switch ($o['tail']) {
        case 'bushy':
            $g->e(0.05, 0.85, 0.16, 0.34, $f);
            break;
        case 'long':
            $g->pl([[0, 0.7], [0.12, 0.95], [0.04, 1.1]], 0.1, $dk);
            break;
        case 'curl':
            $g->pl([[0, 0.7], [0.3, 0.85], [0.42, 0.65], [0.3, 0.5]], 0.08, $f);
            break;
        case 'short':
            $g->e(0, 0.74, 0.08, 0.14, $f);
            break;
        case 'horse':
            $g->e(0, 0.88, 0.18, 0.32, $dk);
            break;
    }
    // legs
    foreach ([[-1, -0.3], [1, -0.3], [-1, 0.45], [1, 0.45]] as [$s, $y]) {
        $g->e($s * ($W + 0.06), $y, 0.1, 0.17, $dk);
    }
    $g->e(0, 0.12, $W, $L, $f);
    if ($o['belly']) {
        $g->e(0, 0.14, $W * 0.45, $L * 0.7, $o['belly'], false);
    }
    if ($o['stripe']) {
        foreach ([-0.15, 0.15, 0.4] as $y) {
            $g->l(-$W * 0.9, $y, $W * 0.9, $y, 0.07, $o['stripe'], false);
        }
    }
    if ($o['mane']) {
        $g->l(0, -0.5, 0, 0.5, 0.12, $o['mane'], false);
    }
    // head
    $hy = -$L - 0.02;
    if ($o['ear'] === 'point') {
        foreach ([-1, 1] as $s) {
            $g->p([[$s * 0.08, $hy - 0.02], [$s * 0.24, $hy - 0.28], [$s * 0.26, $hy + 0.04]], $f);
        }
    } elseif ($o['ear'] === 'round') {
        foreach ([-1, 1] as $s) {
            $g->c($s * 0.2, $hy - 0.1, 0.1, $f);
        }
    } elseif ($o['ear'] === 'floppy') {
        foreach ([-1, 1] as $s) {
            $g->e($s * 0.26, $hy + 0.08, 0.1, 0.18, $dk);
        }
    }
    if ($o['antlers']) {
        foreach ([-1, 1] as $s) {
            $g->pl([[$s * 0.14, $hy - 0.05], [$s * 0.34, $hy - 0.3], [$s * 0.3, $hy - 0.6]], 0.05, '#e7d7b0');
            $g->pl([[$s * 0.3, $hy - 0.3], [$s * 0.55, $hy - 0.36]], 0.04, '#e7d7b0');
            $g->pl([[$s * 0.33, $hy - 0.46], [$s * 0.56, $hy - 0.58]], 0.04, '#e7d7b0');
        }
    }
    $g->e(0, $hy, 0.2, 0.22, $f);
    $g->e(0, $hy - 0.14 - $o['snout'] / 2, 0.11 + ($o['snout'] > 0.3 ? 0 : 0.03), 0.1 + $o['snout'] / 2, $o['belly'] ?? G::shade($f, 0.25));
    $g->c(0, $hy - 0.16 - $o['snout'], 0.05, '#111111', false);
    foreach ([-1, 1] as $s) {
        $g->c($s * 0.1, $hy - 0.04, 0.035, '#f8fafc', false);
    }
    if ($o['tuskCol']) {
        foreach ([-1, 1] as $s) {
            $g->p([[$s * 0.1, $hy - 0.2 - $o['snout']], [$s * 0.2, $hy - 0.38 - $o['snout']], [$s * 0.04, $hy - 0.25 - $o['snout']]], $o['tuskCol']);
        }
    }
}

function eyes(G $g, float $y, string $col, float $r = 0.05, float $dx = 0.1): void
{
    foreach ([-1, 1] as $s) {
        $g->c($s * $dx, $y, $r, $col, false);
    }
}

// ---------------------------------------------------------------- token catalogue
// [key, name, family, size (1|2), tags, draw(G)]
$H = 'Héros';
$M = 'Monstres';
$N = 'PNJ';
$A = 'Animaux';

$tokens = [
    ['guerrier', 'Guerrier', $H, 1, ['héros', 'combattant'], fn (G $g) => human($g, ['body' => '#7a1f1f', 'gear' => 'helm', 'gearCol' => '#9ca3af', 'weapon' => 'sword', 'shield' => ['#b91c1c', 'boss'], 'w' => 1.05])],
    ['magicienne', 'Magicienne', $H, 1, ['héros', 'magie'], fn (G $g) => human($g, ['body' => '#5b21b6', 'gear' => 'hat', 'gearCol' => '#7c3aed', 'weapon' => 'staff', 'hair' => '#f59e0b'])],
    ['voleur', 'Voleur', $H, 1, ['héros', 'discret'], fn (G $g) => human($g, ['body' => '#374151', 'gear' => 'hood', 'gearCol' => '#1f2937', 'weapon' => 'dagger', 'cape' => '#111827'])],
    ['clerc', 'Clerc', $H, 1, ['héros', 'soin'], fn (G $g) => human($g, ['body' => '#e5e7eb', 'trim' => '#d4a017', 'hair' => '#7c4a21', 'weapon' => 'mace', 'shield' => ['#f3f4f6', 'cross']])],
    ['rodeur', 'Rôdeur', $H, 1, ['héros', 'nature'], fn (G $g) => human($g, ['body' => '#3f6212', 'gear' => 'hood', 'gearCol' => '#4d7c0f', 'weapon' => 'bow', 'pack' => '#7c4a21'])],
    ['barde', 'Barde', $H, 1, ['héros', 'musique'], fn (G $g) => human($g, ['body' => '#be185d', 'gear' => 'feather', 'gearCol' => '#0f766e', 'weapon' => 'lute', 'hair' => null])],
    ['paladin', 'Paladin', $H, 1, ['héros', 'combattant'], fn (G $g) => human($g, ['body' => '#cbd5e1', 'trim' => '#d4a017', 'gear' => 'helm', 'gearCol' => '#e5e7eb', 'weapon' => 'sword', 'shield' => ['#1d4ed8', 'cross'], 'w' => 1.05, 'cape' => '#1d4ed8'])],
    ['druide', 'Druide', $H, 1, ['héros', 'nature'], fn (G $g) => human($g, ['body' => '#166534', 'gear' => 'hood', 'gearCol' => '#15803d', 'weapon' => 'staff', 'beard' => '#d1d5db'])],

    ['gobelin', 'Gobelin', $M, 1, ['monstre', 'gobelinoïde'], fn (G $g) => human($g, ['body' => '#6b4423', 'skin' => '#84cc16', 'ears' => true, 'weapon' => 'dagger', 'w' => 0.85, 'hair' => null])],
    ['squelette', 'Squelette', $M, 1, ['monstre', 'mort-vivant'], function (G $g) {
        human($g, ['body' => '#d6d0b8', 'skin' => '#ece6cf', 'weapon' => 'sword', 'w' => 0.8]);
        foreach ([0.04, 0.14, 0.24] as $y) {
            $g->l(-0.4, $y, 0.4, $y, 0.04, '#5b5545', false);
        }
        $g->c(0, -0.02, 0.3, '#ece6cf');
        eyes($g, -0.1, '#111111', 0.07, 0.12);
        $g->l(-0.14, 0.12, 0.14, 0.12, 0.04, '#5b5545', false);
    }],
    ['orc', 'Orc', $M, 1, ['monstre', 'humanoïde'], fn (G $g) => human($g, ['body' => '#4b3621', 'skin' => '#4d7c0f', 'weapon' => 'axe', 'w' => 1.2, 'tusks' => true, 'gear' => 'cap', 'gearCol' => '#374151'])],
    ['araignee', 'Araignée géante', $M, 1, ['monstre', 'bête'], function (G $g) {
        foreach ([-1, 1] as $s) {
            foreach ([[-0.3, -0.85, -0.55], [-0.1, -0.95, 0.0], [0.1, -0.9, 0.4], [0.3, -0.75, 0.85]] as [$y0, $x1, $y1]) {
                $g->pl([[$s * 0.2, $y0], [$s * 0.7, $y0 - 0.3], [$s * 0.98, ($y1 + $y0) / 2 + 0.1 * 0 + 0.0]], 0.07, '#2a2230');
            }
        }
        $g->e(0, 0.3, 0.34, 0.45, '#3b2f45');
        $g->p([[0, 0.12], [0.1, 0.3], [0, 0.48], [-0.1, 0.3]], '#dc2626', false);
        $g->c(0, -0.2, 0.22, '#4a3b57');
        eyes($g, -0.28, '#ef4444', 0.05, 0.08);
        eyes($g, -0.18, '#ef4444', 0.04, 0.14);
    }],
    ['slime', 'Gelée', $M, 1, ['monstre', 'vase'], function (G $g) {
        $pts = [];
        for ($i = 0; $i < 24; $i++) {
            $a = $i * M_PI / 12;
            $r = 0.78 + 0.1 * sin(3 * $a + 0.7) + 0.05 * cos(5 * $a);
            $pts[] = [$r * cos($a), 0.05 + $r * 0.9 * sin($a)];
        }
        $g->p($pts, '#4ade80');
        $g->e(0, 0.18, 0.48, 0.38, '#22c55e', false);
        $g->e(-0.3, -0.35, 0.2, 0.1, '#bbf7d0', false);
        $g->c(0.35, 0.4, 0.07, '#bbf7d0', false);
        $g->c(-0.18, 0.0, 0.11, '#f8fafc', false);
        $g->c(0.18, 0.0, 0.11, '#f8fafc', false);
        $g->c(-0.18, 0.02, 0.05, '#111111', false);
        $g->c(0.18, 0.02, 0.05, '#111111', false);
    }],
    ['zombie', 'Zombie', $M, 1, ['monstre', 'mort-vivant'], fn (G $g) => human($g, ['body' => '#5b6b4a', 'skin' => '#8fa88a', 'handsFwd' => true, 'hair' => '#3f3f46', 'trim' => '#7f1d1d'])],
    ['kobold', 'Kobold', $M, 1, ['monstre', 'draconique'], function (G $g) {
        $g->pl([[0, 0.5], [0.15, 0.8], [0.05, 1.0]], 0.12, '#b45309');
        human($g, ['body' => '#7c2d12', 'skin' => '#c2410c', 'ears' => true, 'weapon' => 'spear', 'w' => 0.78, 'gear' => 'cap', 'gearCol' => '#92400e']);
        eyes($g, -0.1, '#fde047', 0.04, 0.1);
    }],
    ['rat_geant', 'Rat géant', $M, 1, ['monstre', 'bête'], fn (G $g) => beast($g, ['fur' => '#78716c', 'belly' => '#d6c7b4', 'ear' => 'round', 'snout' => 0.28, 'tail' => 'long', 'len' => 0.5, 'wid' => 0.3])],
    ['spectre', 'Spectre', $M, 1, ['monstre', 'mort-vivant'], function (G $g) {
        $g->p([[-0.5, 0.0], [0.5, 0.0], [0.7, 0.55], [0.45, 0.4], [0.3, 0.9], [0.05, 0.5], [-0.2, 0.95], [-0.38, 0.45], [-0.7, 0.6]], '#a5b4fc');
        $g->e(0, 0.0, 0.42, 0.4, '#c7d2fe', false);
        $g->c(0, -0.1, 0.3, '#312e81');
        eyes($g, -0.14, '#a7f3d0', 0.07, 0.11);
        $g->e(0, 0.08, 0.06, 0.1, '#1e1b4b', false);
    }],
    ['cultiste', 'Cultiste', $M, 1, ['monstre', 'humanoïde'], fn (G $g) => human($g, ['body' => '#7f1d1d', 'gear' => 'hood', 'gearCol' => '#450a0a', 'weapon' => 'dagger', 'trim' => '#1b1b22'])],
    ['ogre', 'Ogre', $M, 2, ['monstre', 'géant', '2×2'], fn (G $g) => human($g, ['body' => '#92400e', 'skin' => '#c08d4a', 'weapon' => 'club', 'w' => 1.25, 'tusks' => true, 'hair' => '#3b2412', 'apron' => '#6b4423'])],
    ['troll', 'Troll', $M, 2, ['monstre', 'géant', '2×2'], fn (G $g) => human($g, ['body' => '#365314', 'skin' => '#65a30d', 'weapon' => 'club', 'w' => 1.25, 'ears' => true, 'hair' => '#14532d', 'tusks' => true])],
    ['dragon_jeune', 'Dragon jeune', $M, 2, ['monstre', 'dragon', '2×2'], function (G $g) {
        // tail
        $g->pl([[0, 0.3], [0.1, 0.65], [-0.12, 0.9], [0.05, 1.1]], 0.2, '#b91c1c');
        $g->p([[0.05, 1.0], [0.0, 1.2], [0.15, 1.05]], '#7f1d1d');
        // wings
        foreach ([-1, 1] as $s) {
            $g->p([[$s * 0.2, 0.0], [$s * 1.05, -0.5], [$s * 0.95, -0.1], [$s * 1.0, 0.15], [$s * 0.7, 0.2], [$s * 0.6, 0.45], [$s * 0.3, 0.3]], '#7f1d1d');
            $g->l($s * 0.2, 0.0, $s * 1.0, -0.45, 0.05, '#450a0a', false);
            $g->l($s * 0.25, 0.1, $s * 0.95, 0.12, 0.04, '#450a0a', false);
        }
        $g->e(0, 0.1, 0.34, 0.6, '#dc2626');
        $g->e(0, 0.18, 0.18, 0.45, '#fbbf24', false);
        foreach ([-0.3, -0.05, 0.2, 0.45] as $y) {
            $g->p([[0, $y - 0.1], [0.07, $y], [-0.07, $y]], '#7f1d1d', false);
        }
        // head
        $g->e(0, -0.62, 0.22, 0.28, '#ef4444');
        $g->e(0, -0.85, 0.12, 0.16, '#ef4444');
        foreach ([-1, 1] as $s) {
            $g->p([[$s * 0.15, -0.55], [$s * 0.34, -0.85], [$s * 0.24, -0.5]], '#f5f0dc');
        }
        eyes($g, -0.66, '#fde047', 0.04, 0.12);
        eyes($g, -0.96, '#111111', 0.025, 0.05);
    }],
    ['golem', 'Golem', $M, 2, ['monstre', 'artificiel', '2×2'], function (G $g) {
        $stone = '#8b8f98';
        foreach ([-1, 1] as $s) {
            $g->p([[$s * 0.5, -0.1], [$s * 0.85, -0.1], [$s * 0.9, -0.6], [$s * 0.55, -0.62]], G::shade($stone, -0.1));
            $g->p([[$s * 0.5, 0.0], [$s * 0.85, 0.0], [$s * 0.85, 0.32], [$s * 0.5, 0.32]], G::shade($stone, -0.2));
        }
        $g->p([[-0.55, -0.2], [0.55, -0.2], [0.65, 0.5], [-0.65, 0.5]], $stone);
        $g->p([[-0.3, 0.0], [0.3, 0.0], [0.25, 0.35], [-0.25, 0.35]], G::shade($stone, 0.18), false);
        $g->l(0, 0.05, 0, 0.3, 0.05, '#22d3ee', false);
        $g->l(-0.12, 0.17, 0.12, 0.17, 0.05, '#22d3ee', false);
        $g->p([[-0.28, -0.2], [0.28, -0.2], [0.26, -0.62], [-0.26, -0.62]], G::shade($stone, 0.1));
        $g->l(-0.18, -0.46, 0.18, -0.46, 0.08, '#22d3ee', false);
        $g->l(-0.2, -0.3, -0.05, -0.34, 0.03, '#4b5563', false);
    }],

    ['garde', 'Garde', $N, 1, ['pnj', 'ville'], fn (G $g) => human($g, ['body' => '#1e3a8a', 'trim' => '#d4a017', 'gear' => 'helm', 'gearCol' => '#9ca3af', 'weapon' => 'spear', 'shield' => ['#1e40af', 'boss']])],
    ['marchand', 'Marchand', $N, 1, ['pnj', 'commerce'], fn (G $g) => human($g, ['body' => '#b45309', 'gear' => 'cap', 'gearCol' => '#78350f', 'pack' => '#a16207', 'trim' => '#fde68a', 'beard' => '#6b7280'])],
    ['aubergiste', 'Aubergiste', $N, 1, ['pnj', 'taverne'], fn (G $g) => human($g, ['body' => '#7c4a21', 'apron' => '#f8fafc', 'weapon' => 'mug', 'beard' => '#92400e', 'w' => 1.1])],
    ['noble', 'Noble', $N, 1, ['pnj', 'cour'], fn (G $g) => human($g, ['body' => '#6d28d9', 'trim' => '#fde68a', 'gear' => 'crown', 'hair' => '#4b2e1e', 'cape' => '#4c1d95'])],
    ['paysan', 'Paysan', $N, 1, ['pnj', 'campagne'], fn (G $g) => human($g, ['body' => '#a8a29e', 'gear' => 'straw', 'weapon' => 'fork'])],
    ['pretre', 'Prêtre', $N, 1, ['pnj', 'temple'], fn (G $g) => human($g, ['body' => '#f1f5f9', 'trim' => '#d4a017', 'gear' => 'tonsure', 'weapon' => 'book'])],
    ['forgeron', 'Forgeron', $N, 1, ['pnj', 'artisan'], fn (G $g) => human($g, ['body' => '#57534e', 'apron' => '#44403c', 'weapon' => 'hammer', 'beard' => '#7c2d12', 'w' => 1.15])],
    ['mendiant', 'Mendiant', $N, 1, ['pnj', 'rue'], fn (G $g) => human($g, ['body' => '#6b6258', 'gear' => 'hood', 'gearCol' => '#78716c', 'weapon' => 'bowl', 'w' => 0.9])],

    ['loup', 'Loup', $A, 1, ['animal', 'sauvage'], fn (G $g) => beast($g, ['fur' => '#6b7280', 'belly' => '#d1d5db', 'ear' => 'point', 'snout' => 0.3, 'tail' => 'bushy'])],
    ['ours', 'Ours', $A, 2, ['animal', 'sauvage', '2×2'], fn (G $g) => beast($g, ['fur' => '#7c4a21', 'belly' => '#c9a37a', 'ear' => 'round', 'snout' => 0.12, 'tail' => 'short', 'wid' => 0.5, 'len' => 0.62])],
    ['cheval', 'Cheval', $A, 1, ['animal', 'monture'], fn (G $g) => beast($g, ['fur' => '#8b5a2b', 'ear' => 'point', 'snout' => 0.36, 'tail' => 'horse', 'mane' => '#2e1a0e', 'len' => 0.62, 'wid' => 0.3])],
    ['chat', 'Chat', $A, 1, ['animal', 'domestique'], fn (G $g) => beast($g, ['fur' => '#f59e0b', 'belly' => '#fde68a', 'ear' => 'point', 'snout' => 0.0, 'tail' => 'curl', 'stripe' => '#b45309', 'len' => 0.45, 'wid' => 0.28])],
    ['chien', 'Chien', $A, 1, ['animal', 'domestique'], fn (G $g) => beast($g, ['fur' => '#c08a50', 'belly' => '#f1d9b0', 'ear' => 'floppy', 'snout' => 0.2, 'tail' => 'curl', 'len' => 0.5])],
    ['sanglier', 'Sanglier', $A, 1, ['animal', 'sauvage'], fn (G $g) => beast($g, ['fur' => '#3f3a36', 'ear' => 'point', 'snout' => 0.24, 'tail' => 'short', 'tuskCol' => '#f5f0dc', 'mane' => '#1c1917', 'wid' => 0.4])],
    ['cerf', 'Cerf', $A, 1, ['animal', 'forêt'], fn (G $g) => beast($g, ['fur' => '#a16207', 'belly' => '#fde9b8', 'ear' => 'point', 'snout' => 0.24, 'tail' => 'short', 'antlers' => true, 'len' => 0.58, 'wid' => 0.3])],
    ['ane', 'Âne', $A, 1, ['animal', 'monture'], fn (G $g) => beast($g, ['fur' => '#9ca3af', 'belly' => '#e5e7eb', 'ear' => 'point', 'snout' => 0.28, 'tail' => 'long', 'len' => 0.55, 'wid' => 0.3, 'mane' => '#6b7280'])],
    ['corbeau', 'Corbeau', $A, 1, ['animal', 'oiseau'], function (G $g) {
        foreach ([-1, 1] as $s) {
            $g->p([[$s * 0.15, -0.1], [$s * 0.95, -0.35], [$s * 0.85, -0.05], [$s * 0.95, 0.2], [$s * 0.7, 0.2], [$s * 0.6, 0.45], [$s * 0.15, 0.35]], '#1f2937');
            $g->l($s * 0.2, -0.05, $s * 0.9, -0.28, 0.03, '#4b5563', false);
        }
        $g->p([[-0.18, 0.4], [0.18, 0.4], [0.28, 0.95], [0, 0.82], [-0.28, 0.95]], '#111827');
        $g->e(0, 0.1, 0.24, 0.42, '#374151');
        $g->c(0, -0.42, 0.18, '#1f2937');
        $g->p([[-0.07, -0.55], [0.07, -0.55], [0, -0.85]], '#d4a017');
        eyes($g, -0.46, '#e5e7eb', 0.03, 0.09);
    }],
    ['serpent', 'Serpent', $A, 1, ['animal', 'reptile'], function (G $g) {
        $pts = [];
        for ($i = 0; $i <= 40; $i++) {
            $t = $i / 40;
            $a = 0.4 + $t * 4.6 * M_PI / 1.0 * 0.62;
            $r = 0.78 - 0.55 * $t;
            $pts[] = [$r * cos($a), $r * sin($a) + 0.02];
        }
        $g->pl($pts, 0.2, '#65a30d');
        for ($i = 2; $i < 40; $i += 5) {
            $g->c($pts[$i][0], $pts[$i][1], 0.06, '#365314', false);
        }
        $h = $pts[0];
        $g->e($h[0], $h[1], 0.16, 0.2, '#84cc16');
        $g->l($h[0], $h[1] + 0.18, $h[0], $h[1] + 0.42, 0.025, '#dc2626', false);
        eyes($g, $h[1] - 0.03, '#facc15', 0.04, 0.08);
        foreach ([-1, 1] as $s) {
            $g->c($h[0] + $s * 0.08, $h[1] - 0.03, 0.04, '#facc15', false);
        }
    }],
];

if (count($tokens) !== 40) {
    fwrite(STDERR, 'Expected 40 tokens, got ' . count($tokens) . "\n");
    exit(1);
}

$ring = ['Héros' => '#3b82f6', 'Monstres' => '#dc2626', 'PNJ' => '#eab308', 'Animaux' => '#16a34a'];
$bg = ['Héros' => '#243a63', 'Monstres' => '#4a2020', 'PNJ' => '#5c4a14', 'Animaux' => '#24402c'];

function render(array $t, array $ring, array $bg): \GdImage
{
    [$key, , $fam, $size] = $t;
    mt_srand(crc32($key)); // fixed seed per token
    $px = $size === 2 ? 512 : 256;
    $n = $px * SS;
    $R = $n / 2 - 2 * SS;           // outer radius
    $ringW = $n * 0.075;
    $Ri = $R - $ringW;              // inner radius
    $base = new G($n, $Ri * 1.02);
    $im = $base->im;
    $c = $n / 2;
    $disc = static function (G $g, float $r, string $hex) use ($c): void {
        imagefilledellipse($g->im, (int) $c, (int) $c, (int) (2 * $r), (int) (2 * $r), $g->col($hex));
    };
    // ring
    $disc($base, $R, '#101014');
    $disc($base, $R - $n * 0.012, G::shade($ring[$fam], -0.15));
    $disc($base, $Ri + $n * 0.012, '#101014');
    // inner background with radial vignette
    for ($i = 10; $i >= 0; $i--) {
        $disc($base, $Ri * (0.05 + 0.095 * $i) + ($i === 10 ? 0 : 0), G::shade($bg[$fam], -0.35 + 0.35 * (10 - $i) / 10));
    }
    // emblem on a separate layer, clipped to the inner disc
    $layer = new G($n, $Ri * 1.02);
    $layer->o = 0.045;
    $t[5]($layer);
    imagealphablending($layer->im, false);
    $clear = imagecolorallocatealpha($layer->im, 0, 0, 0, 127);
    for ($y = 0; $y < $n; $y++) {
        $dy = $y + 0.5 - $c;
        $half = $Ri * $Ri - $dy * $dy;
        if ($half <= 0) {
            imagefilledrectangle($layer->im, 0, $y, $n - 1, $y, $clear);
            continue;
        }
        $hx = (int) floor(sqrt($half));
        imagefilledrectangle($layer->im, 0, $y, (int) $c - $hx - 1, $y, $clear);
        imagefilledrectangle($layer->im, (int) $c + $hx, $y, $n - 1, $y, $clear);
    }
    imagealphablending($im, true);
    imagecopy($im, $layer->im, 0, 0, 0, 0, $n, $n);
    // light shading: soft highlight arc on the ring (top-left) and darker bottom-right edge
    imagesetthickness($im, (int) ($n * 0.012));
    imagearc($im, (int) $c, (int) $c, (int) (2 * ($R - $ringW * 0.35)), (int) (2 * ($R - $ringW * 0.35)), 200, 285, $base->col('#ffffff', 85));
    imagearc($im, (int) $c, (int) $c, (int) (2 * ($R - $ringW * 0.7)), (int) (2 * ($R - $ringW * 0.7)), 20, 105, $base->col('#000000', 85));
    imagesetthickness($im, 1);
    // downsample
    $out = imagecreatetruecolor($px, $px);
    imagealphablending($out, false);
    imagesavealpha($out, true);
    imagefill($out, 0, 0, imagecolorallocatealpha($out, 0, 0, 0, 127));
    imagecopyresampled($out, $im, 0, 0, 0, 0, $px, $px, $n, $n);

    return $out;
}

function rgbaSha(\GdImage $im): string
{
    $w = imagesx($im);
    $h = imagesy($im);
    $b = '';
    for ($y = 0; $y < $h; $y++) {
        for ($x = 0; $x < $w; $x++) {
            $c = imagecolorat($im, $x, $y);
            $b .= chr(($c >> 16) & 255) . chr(($c >> 8) & 255) . chr($c & 255) . chr((int) round(255 - (($c >> 24) & 127) * 255 / 127));
        }
    }

    return hash('sha256', $b);
}

// ---------------------------------------------------------------- run
$sheetPath = null;
$argv = $_SERVER['argv'];
if (($i = array_search('--sheet', $argv, true)) !== false) {
    $sheetPath = $argv[$i + 1] ?? null;
}

$entries = [];
$images = [];
foreach ($tokens as $t) {
    [$key, $name, $fam, $size, $tags] = $t;
    $im = render($t, $ring, $bg);
    $file = 'token.' . $key . '.png';
    imagepng($im, $packDir . '/' . $file, 9);
    $images[] = [$im, $size];
    $entries[] = [
        'key' => 'token.' . $key,
        'file' => $file,
        'name' => $name,
        'category' => $fam, // general category, created by the installer when missing
        'kind' => 'token',
        'tags' => $tags,
        'rgba_sha256' => rgbaSha($im),
    ];
}

$packFile = $packDir . '/tokens.json';
$pack = is_file($packFile) ? json_decode((string) file_get_contents($packFile), true, 512, JSON_THROW_ON_ERROR) : ['version' => 0, 'entries' => []];
// bump the version only when the token set changed (BasePackManifest adds it to the tile pack version)
$newPack = ['version' => $pack['entries'] === $entries ? $pack['version'] : $pack['version'] + 1, 'entries' => $entries];
$json = json_encode($newPack, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
$json = preg_replace_callback('/^ +/m', static fn (array $m): string => str_repeat(' ', intdiv(strlen($m[0]), 2)), $json);
file_put_contents($packFile, $json . "\n");
echo 'Wrote ' . count($entries) . ' tokens, pack version ' . $newPack['version'] . "\n";

if ($sheetPath !== null) {
    $cell = 200;
    $cols = 8;
    $rows = (int) ceil(count($images) / $cols);
    $sheet = imagecreatetruecolor($cols * $cell, $rows * $cell);
    imagefill($sheet, 0, 0, imagecolorallocate($sheet, 120, 140, 110));
    foreach ($images as $i => [$im, $size]) {
        $d = $size === 2 ? $cell - 4 : (int) ($cell * 0.5);
        $d = $size === 2 ? $cell - 6 : 100; // 1x1 shown smaller than 2x2
        imagecopyresampled($sheet, $im, ($i % $cols) * $cell + (int) (($cell - $d) / 2), intdiv($i, $cols) * $cell + (int) (($cell - $d) / 2), 0, 0, $d, $d, imagesx($im), imagesy($im));
    }
    imagepng($sheet, $sheetPath);
}
