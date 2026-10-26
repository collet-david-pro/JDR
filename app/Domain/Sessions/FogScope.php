<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions;

defined('JDR_BOOT') || exit;

/**
 * What a player may receive of a map under fog_strict (projet.md 14.2, D4 / D11): a set of
 * 32 x 32 cell blocks per floor, or no restriction (fog_strict off). Pure value, built by
 * FogStrictScope.
 */
final class FogScope
{
    public const SIZE = 32;
    /** Above this many blocks in a box, the allowed blocks are tested instead of the box blocks. */
    private const BOX_WALK_MAX = 256;

    /**
     * @param array<int, array<string, true>>|null $blocks floor id => ["cx:cy" => true]; null = unrestricted
     */
    private function __construct(private ?array $blocks)
    {
    }

    public static function unrestricted(): self
    {
        return new self(null);
    }

    /**
     * @param array<int, array<string, true>> $blocks
     */
    public static function of(array $blocks): self
    {
        return new self($blocks);
    }

    public function isRestricted(): bool
    {
        return $this->blocks !== null;
    }

    public function allowsBlock(int $floorId, int $cx, int $cy): bool
    {
        return $this->blocks === null || isset($this->blocks[$floorId][$cx . ':' . $cy]);
    }

    public function allowsPoint(int $floorId, float $x, float $y): bool
    {
        return $this->blocks === null || ($x >= 0 && $y >= 0
            && $this->allowsBlock($floorId, (int) floor($x / self::SIZE), (int) floor($y / self::SIZE)));
    }

    /**
     * Does the box [x1, y1, x2, y2] (cells) touch an allowed block of the floor?
     *
     * @param array{0: float, 1: float, 2: float, 3: float} $box
     */
    public function allowsBox(int $floorId, array $box): bool
    {
        if ($this->blocks === null) {
            return true;
        }
        $allowed = $this->blocks[$floorId] ?? [];
        if ($allowed === []) {
            return false;
        }
        $cx1 = max(0, (int) floor($box[0] / self::SIZE));
        $cy1 = max(0, (int) floor($box[1] / self::SIZE));
        $cx2 = (int) floor($box[2] / self::SIZE);
        $cy2 = (int) floor($box[3] / self::SIZE);
        if ($cx2 < $cx1 || $cy2 < $cy1) {
            return false;
        }
        if (($cx2 - $cx1 + 1) * ($cy2 - $cy1 + 1) > self::BOX_WALK_MAX) {
            foreach (array_keys($allowed) as $key) {
                [$cx, $cy] = array_map('intval', explode(':', $key));
                if ($cx >= $cx1 && $cx <= $cx2 && $cy >= $cy1 && $cy <= $cy2) {
                    return true;
                }
            }

            return false;
        }
        for ($cy = $cy1; $cy <= $cy2; $cy++) {
            for ($cx = $cx1; $cx <= $cx2; $cx++) {
                if (isset($allowed[$cx . ':' . $cy])) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Allowed blocks of a floor: [[cx, cy]], null when unrestricted.
     *
     * @return list<array{0: int, 1: int}>|null
     */
    public function cells(int $floorId): ?array
    {
        if ($this->blocks === null) {
            return null;
        }
        $out = [];
        foreach (array_keys($this->blocks[$floorId] ?? []) as $key) {
            [$cx, $cy] = array_map('intval', explode(':', $key));
            $out[] = [$cx, $cy];
        }

        return $out;
    }

    /**
     * Requested blocks (null = every block) reduced to the allowed ones; null = unrestricted.
     *
     * @param list<array{0: int, 1: int}>|null $requested
     * @return list<array{0: int, 1: int}>|null
     */
    public function filterCells(int $floorId, ?array $requested): ?array
    {
        if ($this->blocks === null) {
            return $requested;
        }
        $allowed = $this->cells($floorId) ?? [];
        if ($requested === null) {
            return $allowed;
        }

        return array_values(array_filter($requested, fn (array $c): bool => $this->allowsBlock($floorId, $c[0], $c[1])));
    }

    /**
     * Floors that have at least one allowed block.
     *
     * @return list<int>
     */
    public function floors(): array
    {
        return $this->blocks === null ? [] : array_map('intval', array_keys(array_filter($this->blocks, static fn (array $b): bool => $b !== [])));
    }
}
