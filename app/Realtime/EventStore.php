<?php

declare(strict_types=1);

namespace JDR\Realtime;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Db;
use JDR\Core\Ids;
use JDR\Core\Response;

/**
 * Writes events (projet.md 10.1, etapes P06 D1) in the transaction of the change they describe:
 * - record() only buffers (it requires a transaction opened by Db::transaction(): no event
 *   without a change);
 * - just before COMMIT (Db::beforeCommit) the buffer is flushed: SELECT ... FROM event_seq
 *   WHERE id = 1 FOR UPDATE, then the INSERTs. The lock is held until COMMIT, so every
 *   transaction that writes events is serialized between the attribution of its ids and its
 *   COMMIT: ids become visible in increasing order ("id > since" is safe, across channels).
 *   The lock is taken last, after the business locks: no deadlock with them;
 * - after COMMIT the channels are signalled (ChannelSignal); a rollback drops the buffer
 *   without any signal (and a deadlock retry starts again from an empty buffer).
 * Payload ids (id, *_id, *_ids) are stored as strings, like every API response.
 */
final class EventStore
{
    public const NOTICE_KINDS = ['maintenance', 'reload'];
    private const TYPE_PATTERN = '/^[a-z][a-z0-9_.]{0,39}$/';
    private const CLIENT_OP_ID_MAX = 40;
    private const INSERT_BATCH = 100;

    /** @var list<array{channel: string, type: string, audience: string, audience_user_id: ?int, payload: string, actor_user_id: ?int, client_op_id: ?string, ephemeral: int}> */
    private array $buffer = [];
    /** @var array<string, int> channel => last id flushed in the current transaction */
    private array $flushed = [];
    private bool $hooked = false;
    private bool $flushQueued = false;
    private ?int $lastCommittedId = null;

    public function __construct(private Db $db, private Clock $clock, private ChannelSignal $signal)
    {
    }

    /**
     * Buffers an event of the current transaction.
     *
     * @param array<string, mixed> $payload JSON object (an empty array is stored as {})
     * @throws \LogicException outside a transaction
     * @throws \InvalidArgumentException on an invalid channel, type, audience or payload
     */
    public function record(
        string $channel,
        string $type,
        string $audience,
        array $payload,
        ?int $audienceUserId = null,
        ?int $actorId = null,
        ?string $clientOpId = null,
        bool $ephemeral = false,
    ): void {
        if (!$this->db->inTransaction()) {
            throw new \LogicException('EventStore::record() outside a transaction (no event without a change).');
        }
        self::validate($channel, $type, $audience, $payload, $audienceUserId, $clientOpId);
        $json = $payload === [] ? '{}' : json_encode(Ids::stringify($payload), Response::JSON_FLAGS);
        if (!$this->flushQueued) {
            // Queued again when an event is recorded by a later before-commit hook.
            $this->flushQueued = true;
            $this->db->beforeCommit(function (Db $db): void {
                $this->flush($db);
            });
        }
        if (!$this->hooked) {
            $this->hooked = true;
            $this->db->afterCommit(function (): void {
                $this->committed();
            });
            $this->db->afterRollback(function (): void {
                $this->reset();
            });
        }
        $this->buffer[] = [
            'channel' => $channel,
            'type' => $type,
            'audience' => $audience,
            'audience_user_id' => $audienceUserId,
            'payload' => $json,
            'actor_user_id' => $actorId,
            'client_op_id' => $clientOpId,
            'ephemeral' => $ephemeral ? 1 : 0,
        ];
    }

    /**
     * server.notice {kind, message} (audience all) on $channels, or on the channel of every
     * session that is not ended. Joins the current transaction, else opens one.
     *
     * @param list<string>|null $channels
     * @return int number of events written
     */
    public function serverNotice(string $kind, string $message, ?array $channels = null): int
    {
        if (!in_array($kind, self::NOTICE_KINDS, true)) {
            throw new \InvalidArgumentException('Invalid notice kind: ' . $kind);
        }

        return (int) $this->db->transaction(function (Db $db) use ($kind, $message, $channels): int {
            if ($channels === null) {
                $channels = array_map(
                    static fn (mixed $id): string => Channel::session((int) $id),
                    array_column($db->fetchAll(
                        'SELECT `id` FROM ' . $db->t('play_sessions') . " WHERE `state` <> 'ended' ORDER BY `id`",
                    ), 'id'),
                );
            }
            foreach ($channels as $channel) {
                $this->record($channel, 'server.notice', Audience::ALL, ['kind' => $kind, 'message' => $message]);
            }

            return count($channels);
        });
    }

    /**
     * Highest event id committed by this store (this process), e.g. last_event_id of a response.
     */
    public function lastCommittedId(): ?int
    {
        return $this->lastCommittedId;
    }

    /**
     * Number of events buffered in the current transaction (tests, diagnostics).
     */
    public function pending(): int
    {
        return count($this->buffer);
    }

    /**
     * @param array<string, mixed> $payload
     */
    private static function validate(
        string $channel,
        string $type,
        string $audience,
        array $payload,
        ?int $audienceUserId,
        ?string $clientOpId,
    ): void {
        if (!Channel::isValid($channel)) {
            throw new \InvalidArgumentException('Invalid channel: ' . $channel);
        }
        if (preg_match(self::TYPE_PATTERN, $type) !== 1) {
            throw new \InvalidArgumentException('Invalid event type: ' . $type);
        }
        if (!in_array($audience, Audience::VALUES, true)) {
            throw new \InvalidArgumentException('Invalid audience: ' . $audience);
        }
        if (($audience === Audience::USER) !== ($audienceUserId !== null)) {
            throw new \InvalidArgumentException('audience_user_id is required for (and only for) the audience "user".');
        }
        if ($payload !== [] && array_is_list($payload)) {
            throw new \InvalidArgumentException('The payload of an event is a JSON object.');
        }
        if ($clientOpId !== null && ($clientOpId === '' || strlen($clientOpId) > self::CLIENT_OP_ID_MAX)) {
            throw new \InvalidArgumentException('Invalid client_op_id.');
        }
    }

    private function flush(Db $db): void
    {
        $this->flushQueued = false;
        if ($this->buffer === []) {
            return;
        }
        $seq = $db->fetchValue('SELECT `purged_upto` FROM ' . $db->t('event_seq') . ' WHERE `id` = 1 FOR UPDATE');
        if ($seq === null) {
            throw new \RuntimeException('Missing event_seq row (migration 0003_events_seq).');
        }
        $now = $this->clock->sql();
        foreach (array_chunk($this->buffer, self::INSERT_BATCH) as $rows) {
            $values = [];
            $params = [];
            foreach ($rows as $row) {
                $values[] = '(?, ?, ?, ?, ?, ?, ?, ?, ?)';
                array_push(
                    $params,
                    $row['channel'],
                    $row['type'],
                    $row['audience'],
                    $row['audience_user_id'],
                    $row['payload'],
                    $row['actor_user_id'],
                    $row['client_op_id'],
                    $row['ephemeral'],
                    $now,
                );
            }
            $db->execute(
                'INSERT INTO ' . $db->t('events') . ' (`channel`, `type`, `audience`, `audience_user_id`, `payload`, '
                . '`actor_user_id`, `client_op_id`, `ephemeral`, `created_at`) VALUES ' . implode(', ', $values),
                $params,
            );
            $first = (int) $db->lastInsertId();
            // Serialized by the event_seq lock: the rows >= $first are ours (read back rather than
            // assume consecutive ids, auto_increment_increment may be > 1).
            $ids = count($rows) === 1 ? [$first] : array_map('intval', array_column($db->fetchAll(
                'SELECT `id` FROM ' . $db->t('events') . ' WHERE `id` >= ? ORDER BY `id` LIMIT ' . count($rows),
                [$first],
            ), 'id'));
            foreach ($rows as $i => $row) {
                $id = $ids[$i] ?? $first + $i;
                $this->flushed[$row['channel']] = max($this->flushed[$row['channel']] ?? 0, $id);
            }
        }
        $this->buffer = [];
    }

    private function committed(): void
    {
        $flushed = $this->flushed;
        $this->reset();
        if ($flushed === []) {
            return;
        }
        $this->lastCommittedId = max($this->lastCommittedId ?? 0, ...array_values($flushed));
        $this->signal->notify($flushed);
    }

    private function reset(): void
    {
        $this->buffer = [];
        $this->flushed = [];
        $this->hooked = false;
        $this->flushQueued = false;
    }
}
