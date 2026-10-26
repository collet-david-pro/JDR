<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Db;
use JDR\Domain\Users\User;
use JDR\Realtime\Channel;
use JDR\Realtime\Every;
use JDR\Realtime\LoopListener;
use JDR\Realtime\Subscription;

/**
 * Presence of the players (etapes P06 D6):
 * - POST /presence {session_id} (every 20 s) and the real-time loops (LoopListener, at most every
 *   20 s, and at most one UPDATE per 20 s whatever the number of requests) refresh last_seen_at;
 *   a disconnected player who shows a sign of life is connected again (player.joined);
 * - sweep(): a "connected" player unseen for more than 60 s becomes "disconnected" (ready flag
 *   cleared, player.left). Run by a GM loop every 10 s and by the cron task "presence".
 * Never touches a kicked player nor an ended session.
 */
final class PresenceService implements LoopListener
{
    public const TOUCH_S = 20;
    public const SWEEP_S = 10;
    public const STALE_S = 60;
    private const SWEEP_BATCH = 200;

    /** @var array<string, Every> */
    private array $touchTimers = [];
    /** @var array<string, Every> */
    private array $sweepTimers = [];

    public function __construct(
        private Db $db,
        private Clock $clock,
        private SessionRepository $sessions,
        private SessionEvents $events,
        private SessionAccess $access,
    ) {
    }

    public function onLoopTick(Subscription $sub, float $now): void
    {
        foreach ($sub->grants as $grant) {
            if ($grant->kind !== Channel::SESSION) {
                continue;
            }
            if ($grant->role === 'player' && $sub->userId !== null) {
                if (($this->touchTimers[$grant->channel] ??= new Every(self::TOUCH_S))->due($now)) {
                    $this->touch($grant->targetId, $sub->userId);
                }
            } elseif ($grant->role === 'gm') {
                if (($this->sweepTimers[$grant->channel] ??= new Every(self::SWEEP_S))->due($now)) {
                    $this->sweep($grant->targetId);
                }
            }
        }
    }

    /**
     * POST /presence: a player shows a sign of life; a GM sweeps his session.
     *
     * @throws \JDR\Core\Errors\NotFoundException|\JDR\Core\Errors\ForbiddenException
     */
    public function heartbeat(User $user, int $sessionId): void
    {
        $ctx = $this->access->resolve($user, $sessionId);
        if ($ctx->session->isEnded()) {
            return;
        }
        $ctx->isGm() ? $this->sweep($sessionId) : $this->touch($sessionId, $user->id, true);
    }

    /**
     * Last sign of life of a player. Without $force, at most one write per TOUCH_S seconds.
     */
    public function touch(int $sessionId, int $userId, bool $force = false): void
    {
        $now = $this->clock->timestamp();
        $sql = 'UPDATE ' . $this->db->t('session_players') . " SET `last_seen_at` = ? WHERE `session_id` = ? AND `user_id` = ? AND `status` = 'connected'";
        $params = [$this->clock->sql(), $sessionId, $userId];
        if (!$force) {
            $sql .= ' AND `last_seen_at` <= ?';
            $params[] = gmdate('Y-m-d H:i:s', $now - self::TOUCH_S);
        }
        if ($this->db->execute($sql, $params) > 0) {
            return;
        }
        $status = $this->db->fetchValue(
            'SELECT `status` FROM ' . $this->db->t('session_players') . ' WHERE `session_id` = ? AND `user_id` = ?',
            [$sessionId, $userId],
        );
        if ($status !== 'disconnected') {
            return;
        }
        $this->db->transaction(function () use ($sessionId, $userId): void {
            $session = $this->sessions->findForUpdate($sessionId);
            $player = $this->sessions->player($sessionId, $userId, true);
            if ($session === null || $session->isEnded() || $player === null || $player['status'] !== 'disconnected') {
                return;
            }
            $this->sessions->setPlayerStatus($sessionId, $userId, 'connected');
            $this->events->joined($sessionId, $userId, $player['username'], $userId, null);
        });
    }

    /**
     * Disconnects the players unseen for more than STALE_S seconds (every open session, or one).
     *
     * @return int players disconnected
     */
    public function sweep(?int $sessionId = null): int
    {
        $cutoff = gmdate('Y-m-d H:i:s', $this->clock->timestamp() - self::STALE_S);
        $sql = 'SELECT p.`session_id`, p.`user_id` FROM ' . $this->db->t('session_players') . ' p '
            . 'JOIN ' . $this->db->t('play_sessions') . " s ON s.`id` = p.`session_id` AND s.`state` <> 'ended' "
            . "WHERE p.`status` = 'connected' AND p.`last_seen_at` < ?";
        $params = [$cutoff];
        if ($sessionId !== null) {
            $sql .= ' AND p.`session_id` = ?';
            $params[] = $sessionId;
        }
        $count = 0;
        foreach ($this->db->fetchAll($sql . ' ORDER BY p.`session_id`, p.`user_id` LIMIT ' . self::SWEEP_BATCH, $params) as $row) {
            $count += $this->disconnect((int) $row['session_id'], (int) $row['user_id'], $cutoff);
        }

        return $count;
    }

    private function disconnect(int $sessionId, int $userId, string $cutoff): int
    {
        return (int) $this->db->transaction(function () use ($sessionId, $userId, $cutoff): int {
            $seen = $this->db->fetchValue(
                'SELECT `last_seen_at` FROM ' . $this->db->t('session_players') . ' WHERE `session_id` = ? AND `user_id` = ? AND `status` = \'connected\' FOR UPDATE',
                [$sessionId, $userId],
            );
            if (!is_string($seen) || $seen >= $cutoff) {
                return 0;
            }
            $player = $this->sessions->player($sessionId, $userId);
            $this->sessions->setPlayerStatus($sessionId, $userId, 'disconnected', false);
            $this->events->left($sessionId, $userId, (string) ($player['username'] ?? ''), null, null);

            return 1;
        });
    }
}
