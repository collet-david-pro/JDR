<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions\Actions;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Domain\Maps\MapRepository;
use JDR\Domain\Sessions\EventFanout;
use JDR\Domain\Sessions\EventTypes;
use JDR\Domain\Sessions\ScopeDiff;
use JDR\Domain\Sessions\SessionAccess;
use JDR\Domain\Users\User;

/**
 * A token definition changed (image, imposed GM image, name, size, vision...) while it is placed
 * on the current map of a running or paused session: the snapshots carry the definitions, so each
 * client reloads its own (filtered) snapshot. Written in the transaction of the change:
 * - GM: map.ops.public {reload: true} (payload.view = "gm"), paused included;
 * - while running, players and screens: the same reload-only event, through FanoutBatch::mapOps
 *   (no definition in the payload: a hidden token's definition never reaches a player).
 */
final class TokenDefinitionBroadcaster
{
    public function __construct(
        private Db $db,
        private SessionAccess $access,
        private EventFanout $fanout,
        private MapRepository $maps,
    ) {
    }

    public function changed(User $user, int $gameId, int $tokenId): void
    {
        $rows = $this->db->fetchAll(
            'SELECT s.`id`, s.`current_map_id` FROM ' . $this->db->t('play_sessions') . ' s'
            . " WHERE s.`game_id` = ? AND s.`state` IN ('running', 'paused') AND s.`current_map_id` IS NOT NULL"
            . ' AND EXISTS (SELECT 1 FROM ' . $this->db->t('map_tokens') . ' mt WHERE mt.`map_id` = s.`current_map_id` AND mt.`token_id` = ?)'
            . ' ORDER BY s.`id`',
            [$gameId, $tokenId],
        );
        foreach ($rows as $row) {
            $map = $this->maps->find((int) $row['current_map_id']);
            $ctx = $this->access->resolve($user, (int) $row['id']);
            if ($map === null || !$ctx->isGm()) {
                continue;
            }
            $batch = $this->fanout->begin($ctx, $map, $user->id, null);
            $batch->setRevision($map->revision);
            $batch->gm(EventTypes::MAP_OPS_PUBLIC, ScopeDiff::opsPayload($map->id, $map->revision, [], [], [], true));
            $batch->mapOps([], [], true);
        }
    }
}
