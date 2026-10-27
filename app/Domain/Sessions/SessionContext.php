<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions;

defined('JDR_BOOT') || exit;

/**
 * A session seen by one user (SessionAccess): its role there, and the settings of its game.
 * Role display (P7b): a projection screen of the session (SessionAccess::resolveDisplay), which
 * sees the "table" view (TableView): never GM rights.
 */
final class SessionContext
{
    public const GM = 'gm';
    public const PLAYER = 'player';
    public const DISPLAY = 'display';

    /**
     * @param array<string, mixed> $gameSettings complete games.settings
     */
    public function __construct(
        public readonly Session $session,
        public readonly int $gmUserId,
        public readonly array $gameSettings,
        public readonly string $role,
    ) {
    }

    public function isGm(): bool
    {
        return $this->role === self::GM;
    }

    public function isDisplay(): bool
    {
        return $this->role === self::DISPLAY;
    }

    public function fogStrict(): bool
    {
        return ($this->gameSettings['fog_strict'] ?? true) === true;
    }

    public function setting(string $key): bool
    {
        return ($this->gameSettings[$key] ?? true) === true;
    }

    /**
     * The four session-related game settings (object "settings" of a session).
     *
     * @return array<string, bool>
     */
    public function publicSettings(): array
    {
        return [
            'fog_strict' => $this->fogStrict(),
            'players_blocked_by_walls' => $this->setting('players_blocked_by_walls'),
            'players_can_move_own_tokens' => $this->setting('players_can_move_own_tokens'),
            'players_see_other_pcs' => $this->setting('players_see_other_pcs'),
        ];
    }
}
