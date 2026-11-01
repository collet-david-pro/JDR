<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Domain\Maps\MapNotes;
use JDR\Domain\Maps\MapSceneRepository;
use JDR\Domain\Sessions\Actions\ActionScene;
use JDR\Maps\ObjectRulesNotes;

/**
 * zone.entered (etapes P09 D3; audience gm, ephemeral) {zone_uid, note_uid, title, token_uid}: a
 * token of a player (assigned to a player, or of kind "pc") goes from outside to inside a zone
 * show_on_enter that has a note, on its floor, whoever moved it. Nothing is ever sent to a player:
 * the GM decides what to read.
 */
final class ZoneEntry
{
    public function __construct(private MapSceneRepository $scene, private MapNotes $notes, private Db $db)
    {
    }

    /**
     * @param array<string, mixed> $before placed token (API form)
     * @param array<string, mixed> $after
     */
    public function afterMove(ActionScene $s, FanoutBatch $f, array $before, array $after): void
    {
        $x = (float) $after['x'];
        $y = (float) $after['y'];
        $entered = [];
        foreach ($this->scene->objects($s->map->id, (int) $after['floor'], [$x, $y, $x, $y]) as $zone) {
            if ($zone['type'] !== 'zone' || ($zone['props']['show_on_enter'] ?? false) !== true || !is_string($zone['props']['note'] ?? null)) {
                continue;
            }
            $polygon = $zone['geometry']['polygon'];
            if (ObjectRulesNotes::contains($polygon, $x, $y) && !ObjectRulesNotes::contains($polygon, (float) $before['x'], (float) $before['y'])) {
                $entered[] = $zone;
            }
        }
        if ($entered === [] || !$this->isPlayerToken($s, (int) $after['token_id'])) {
            return;
        }
        $notes = $this->notes->byUids($s->map->id, array_map(static fn (array $z): string => $z['props']['note'], $entered));
        foreach ($entered as $zone) {
            $note = $notes[$zone['props']['note']] ?? null;
            if ($note !== null) {
                $f->gm(EventTypes::ZONE_ENTERED, [
                    'zone_uid' => (string) $zone['uid'],
                    'note_uid' => $note['uid'],
                    'title' => $note['title'],
                    'token_uid' => (string) $after['uid'],
                ], true);
            }
        }
    }

    private function isPlayerToken(ActionScene $s, int $tokenId): bool
    {
        return isset($s->assignments[$tokenId])
            || $this->db->fetchValue('SELECT `kind` FROM ' . $this->db->t('tokens') . ' WHERE `id` = ?', [$tokenId]) === 'pc';
    }
}
