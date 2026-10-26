<?php

declare(strict_types=1);

namespace JDR\Realtime;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Core\Errors\GoneException;

/**
 * Reads the events of a subscription after a cursor (projet.md 10.1-10.4, contract P6a):
 * at most 500 events of id > since, in id order, filtered by audience per channel (10.2).
 *
 * One SQL statement, hence one consistent snapshot, returns the events, the purge mark and the
 * highest id of the channels:
 * - since < event_seq.purged_upto => 410 events_gone (the purge raises the mark before deleting,
 *   so a snapshot missing a purged event always sees the raised mark);
 * - the cursor moves past events of another audience (head of the channels in the same snapshot;
 *   thanks to the event_seq lock (D1) every id below a visible id is committed or never will be).
 */
final class EventReader
{
    public const LIMIT = 500;

    public function __construct(private Db $db)
    {
    }

    /**
     * @throws GoneException 410 events_gone
     */
    public function read(Subscription $sub, int $since, int $limit = self::LIMIT): ReadResult
    {
        $limit = max(1, min(self::LIMIT, $limit));
        $events = $this->db->t('events');
        $heads = [];
        $headParams = [];
        $conds = [];
        $condParams = [];
        foreach ($sub->grants as $channel => $grant) {
            $heads[] = 'COALESCE((SELECT MAX(h.`id`) FROM ' . $events . ' h WHERE h.`channel` = ?), 0)';
            $headParams[] = $channel;
            [$audienceSql, $audienceParams] = Audience::sql('e', $grant->role, $sub->userId);
            $conds[] = '(e.`channel` = ? AND ' . $audienceSql . ')';
            array_push($condParams, $channel, ...$audienceParams);
        }
        $rows = $this->db->fetchAll(
            'SELECT s.`purged_upto` AS `_purged`, GREATEST(0, ' . implode(', ', $heads) . ') AS `_head`, '
            . 'e.`id`, e.`channel`, e.`type`, e.`payload`, e.`actor_user_id`, e.`client_op_id`, e.`created_at` '
            . 'FROM ' . $this->db->t('event_seq') . ' s '
            . 'LEFT JOIN ' . $events . ' e ON e.`id` > ? AND (' . implode(' OR ', $conds) . ') '
            . 'WHERE s.`id` = 1 ORDER BY e.`id` LIMIT ' . $limit,
            [...$headParams, $since, ...$condParams],
        );
        if ($rows === []) {
            throw new \RuntimeException('Missing event_seq row (migration 0003_events_seq).');
        }
        if ($since < (int) $rows[0]['_purged']) {
            throw self::gone($sub);
        }
        $list = [];
        foreach ($rows as $row) {
            if ($row['id'] !== null) {
                $list[] = WireEvent::fromRow($row);
            }
        }
        $more = count($list) === $limit;
        $lastId = $list === [] ? $since : $list[count($list) - 1]->id;
        if (!$more) {
            $lastId = max($lastId, (int) $rows[0]['_head']);
        }

        return new ReadResult($list, $lastId, $more);
    }

    /**
     * Current position of the whole log: max(highest event id, purge mark). This is the
     * last_event_id of a snapshot (read it before the state, or in the same transaction).
     */
    public function headId(): int
    {
        return (int) $this->db->fetchValue(
            'SELECT GREATEST(COALESCE((SELECT MAX(`id`) FROM ' . $this->db->t('events') . '), 0), '
            . 'COALESCE((SELECT `purged_upto` FROM ' . $this->db->t('event_seq') . ' WHERE `id` = 1), 0))',
        );
    }

    public static function gone(Subscription $sub): GoneException
    {
        return new GoneException('', ['channels' => implode(',', $sub->channels())]);
    }
}
