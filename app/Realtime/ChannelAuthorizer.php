<?php

declare(strict_types=1);

namespace JDR\Realtime;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Core\Errors\ConflictException;
use JDR\Core\Errors\ForbiddenException;
use JDR\Core\Errors\NotFoundException;
use JDR\Core\Errors\ValidationException;
use JDR\Domain\Games\Game;

/**
 * Channels a user may read (contract P6a, projet.md 11.2):
 * - session:{id}: GM / co-GM of the game (role gm), or a player of the session whose status is
 *   not "kicked" (role player). Another member of the game, or a kicked player => 403; anyone
 *   else, an unknown session or a game in the trash => 404 (existence never revealed);
 * - map:{id}: GM / co-GM of the game of the map (role gm); a player member => 403; anyone else,
 *   an unknown map, a map outside a game or in the trash => 404.
 * At most 4 distinct channels per request (422 otherwise). One query per channel.
 * A projection screen (authorizeDisplay(), P7b D7) reads the channel of its own session only (role
 * display): another session => 404, a map channel => 403, its session ended => 409
 * session_not_running (the screen waits for a new session: GET /display/me).
 */
final class ChannelAuthorizer
{
    public function __construct(private Db $db)
    {
    }

    /**
     * "session:12,map:34" => ["session:12", "map:34"] (trimmed, duplicates removed).
     *
     * @return list<string>
     * @throws ValidationException channels: required | invalid | too_many
     */
    public static function parse(mixed $raw): array
    {
        if (!is_string($raw) || trim($raw) === '') {
            throw new ValidationException('', ['channels' => 'required']);
        }
        $channels = [];
        foreach (explode(',', $raw) as $part) {
            $channel = trim($part);
            if (!Channel::isValid($channel)) {
                throw new ValidationException('', ['channels' => 'invalid']);
            }
            $channels[$channel] = true;
        }
        if (count($channels) > Channel::MAX_PER_REQUEST) {
            throw new ValidationException('', ['channels' => 'too_many']);
        }

        return array_keys($channels);
    }

    /**
     * @param list<string> $channels valid channel names (see parse())
     * @throws NotFoundException|ForbiddenException on the first channel refused (request order)
     */
    public function authorize(int $userId, array $channels): Subscription
    {
        if ($channels === [] || count($channels) > Channel::MAX_PER_REQUEST) {
            throw new ValidationException('', ['channels' => $channels === [] ? 'required' : 'too_many']);
        }
        $grants = [];
        foreach ($channels as $channel) {
            $parsed = Channel::parse($channel) ?? throw new ValidationException('', ['channels' => 'invalid']);
            [$kind, $id] = $parsed;
            $grants[] = $kind === Channel::SESSION
                ? $this->sessionGrant($userId, $channel, $id)
                : $this->mapGrant($userId, $channel, $id);
        }

        return new Subscription($userId, $grants);
    }

    /**
     * The subscription of a projection screen of session $sessionId (P7b D7).
     *
     * @param list<string> $channels valid channel names (see parse())
     * @throws NotFoundException|ForbiddenException|ConflictException on the first channel refused
     */
    public function authorizeDisplay(int $displayId, int $sessionId, array $channels, ?string $ip = null, ?string $userAgent = null): Subscription
    {
        if ($channels === [] || count($channels) > Channel::MAX_PER_REQUEST) {
            throw new ValidationException('', ['channels' => $channels === [] ? 'required' : 'too_many']);
        }
        $grants = [];
        foreach ($channels as $channel) {
            [$kind, $id] = Channel::parse($channel) ?? throw new ValidationException('', ['channels' => 'invalid']);
            if ($kind !== Channel::SESSION) {
                throw new ForbiddenException();
            }
            if ($id !== $sessionId) {
                throw new NotFoundException();
            }
            $row = $this->db->fetchOne(
                'SELECT s.`game_id`, s.`state`, g.`deleted_at` FROM ' . $this->db->t('play_sessions') . ' s '
                . 'JOIN ' . $this->db->t('games') . ' g ON g.`id` = s.`game_id` WHERE s.`id` = ?',
                [$id],
            );
            if ($row === null || $row['deleted_at'] !== null) {
                throw new NotFoundException();
            }
            if ($row['state'] === 'ended') {
                throw new ConflictException('', ['state' => 'ended'], 'session_not_running');
            }
            $grants[] = new ChannelGrant($channel, Channel::SESSION, $id, (int) $row['game_id'], Audience::ROLE_DISPLAY);
        }

        return new Subscription(null, $grants, $displayId, $ip, $userAgent);
    }

    private function sessionGrant(int $userId, string $channel, int $sessionId): ChannelGrant
    {
        $row = $this->db->fetchOne(
            'SELECT s.`game_id`, g.`gm_user_id`, g.`deleted_at`, m.`role` AS `member_role`, p.`status` AS `player_status` '
            . 'FROM ' . $this->db->t('play_sessions') . ' s '
            . 'JOIN ' . $this->db->t('games') . ' g ON g.`id` = s.`game_id` '
            . 'LEFT JOIN ' . $this->db->t('game_members') . ' m ON m.`game_id` = s.`game_id` AND m.`user_id` = ? '
            . 'LEFT JOIN ' . $this->db->t('session_players') . ' p ON p.`session_id` = s.`id` AND p.`user_id` = ? '
            . 'WHERE s.`id` = ?',
            [$userId, $userId, $sessionId],
        );
        if ($row === null || $row['deleted_at'] !== null) {
            throw new NotFoundException();
        }
        $gameId = (int) $row['game_id'];
        if ((int) $row['gm_user_id'] === $userId || $row['member_role'] === Game::ROLE_CO_GM) {
            return new ChannelGrant($channel, Channel::SESSION, $sessionId, $gameId, Audience::ROLE_GM);
        }
        $status = $row['player_status'];
        if ($status !== null && $status !== 'kicked') {
            return new ChannelGrant($channel, Channel::SESSION, $sessionId, $gameId, Audience::ROLE_PLAYER);
        }
        if ($status !== null || $row['member_role'] !== null) {
            throw new ForbiddenException();
        }

        throw new NotFoundException();
    }

    private function mapGrant(int $userId, string $channel, int $mapId): ChannelGrant
    {
        $row = $this->db->fetchOne(
            'SELECT mp.`game_id`, mp.`deleted_at` AS `map_deleted_at`, g.`gm_user_id`, g.`deleted_at` AS `game_deleted_at`, '
            . 'm.`role` AS `member_role` '
            . 'FROM ' . $this->db->t('maps') . ' mp '
            . 'JOIN ' . $this->db->t('games') . ' g ON g.`id` = mp.`game_id` '
            . 'LEFT JOIN ' . $this->db->t('game_members') . ' m ON m.`game_id` = mp.`game_id` AND m.`user_id` = ? '
            . 'WHERE mp.`id` = ?',
            [$userId, $mapId],
        );
        if ($row === null || $row['game_deleted_at'] !== null) {
            throw new NotFoundException();
        }
        $isGm = (int) $row['gm_user_id'] === $userId || $row['member_role'] === Game::ROLE_CO_GM;
        if (!$isGm && $row['member_role'] === null) {
            throw new NotFoundException();
        }
        if ($row['map_deleted_at'] !== null) {
            throw new NotFoundException();
        }
        if (!$isGm) {
            throw new ForbiddenException();
        }

        return new ChannelGrant($channel, Channel::MAP, $mapId, (int) $row['game_id'], Audience::ROLE_GM);
    }
}
