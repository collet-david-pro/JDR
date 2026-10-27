<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions;

defined('JDR_BOOT') || exit;

/**
 * fog_strict scope of the players of a session (projet.md 14.2, etapes P06 D4 / D11): the 32 x 32
 * blocks a player may receive = explored fog of the floor (shared, Q4) UNION the disk of radius
 * `vision.range + 2` cells around each of his assigned placed tokens (vision disabled: radius 2).
 * Without fog_strict the scope is unrestricted. Reusable by P6c: forUsers() computes the fog and
 * the tokens once for many players (D4: one event per concerned player). forTable() (P7b D6): the
 * scope of the projection screens, same rule with every table viewer (D5) as "his" tokens.
 */
final class FogStrictScope
{
    public const EXTRA_RANGE = 2;

    public function __construct(private SessionSceneQueries $queries)
    {
    }

    public function forUser(SessionContext $ctx, int $userId, int $mapId): FogScope
    {
        return $this->forUsers($ctx, $mapId, [$userId])[$userId];
    }

    /**
     * @param list<int> $userIds
     * @return array<int, FogScope> by user id
     */
    public function forUsers(SessionContext $ctx, int $mapId, array $userIds): array
    {
        if (!$ctx->fogStrict()) {
            return array_fill_keys($userIds, FogScope::unrestricted());
        }
        $explored = $this->queries->fogBlocks($mapId);
        $byUser = array_fill_keys($userIds, $explored);
        foreach ($this->queries->assignedPlaced($ctx->session->id, $mapId) as $t) {
            if (isset($byUser[$t['user_id']])) {
                self::widen($byUser[$t['user_id']], $t);
            }
        }

        return array_map(static fn (array $blocks): FogScope => FogScope::of($blocks), $byUser);
    }

    /**
     * Scope of the "table" (projection screens): explored blocks UNION the disks of the table
     * viewers (SessionSceneQueries::tablePlaced); unrestricted without fog_strict.
     */
    public function forTable(SessionContext $ctx, int $mapId): FogScope
    {
        if (!$ctx->fogStrict()) {
            return FogScope::unrestricted();
        }
        $blocks = $this->queries->fogBlocks($mapId);
        foreach ($this->queries->tablePlaced($ctx->session->id, $mapId) as $t) {
            self::widen($blocks, $t);
        }

        return FogScope::of($blocks);
    }

    /**
     * Adds the vision disk of a placed token to blocks (floor => ["cx:cy" => true]).
     *
     * @param array<int, array<string, true>>                                              $blocks
     * @param array{floor_id: int, x: float, y: float, vision: array<string, mixed>} $t
     */
    private static function widen(array &$blocks, array $t): void
    {
        $enabled = ($t['vision']['enabled'] ?? true) === true;
        $range = $enabled && is_numeric($t['vision']['range'] ?? null) ? (float) $t['vision']['range'] : 0.0;
        foreach (self::disk($t['x'], $t['y'], max(0.0, $range) + self::EXTRA_RANGE) as $key) {
            $blocks[$t['floor_id']][$key] = true;
        }
    }

    /**
     * Keys "cx:cy" of the blocks touched by the disk (center x, y; radius r), cells >= 0.
     *
     * @return list<string>
     */
    public static function disk(float $x, float $y, float $r): array
    {
        $size = FogScope::SIZE;
        $out = [];
        $cx1 = max(0, (int) floor(($x - $r) / $size));
        $cx2 = (int) floor(($x + $r) / $size);
        $cy1 = max(0, (int) floor(($y - $r) / $size));
        $cy2 = (int) floor(($y + $r) / $size);
        for ($cy = $cy1; $cy <= $cy2; $cy++) {
            for ($cx = $cx1; $cx <= $cx2; $cx++) {
                $nx = max($cx * $size, min($x, ($cx + 1) * $size));
                $ny = max($cy * $size, min($y, ($cy + 1) * $size));
                if (($nx - $x) ** 2 + ($ny - $y) ** 2 <= $r * $r) {
                    $out[] = $cx . ':' . $cy;
                }
            }
        }

        return $out;
    }
}
