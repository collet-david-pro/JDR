<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions;

defined('JDR_BOOT') || exit;

/**
 * The "table" view (etapes P07b D5 / D6): what the projection screens of a session see, one view
 * shared by all of them. The table is a virtual player (user id USER) who owns every table viewer
 * (placed token, not hidden, whose definition is assigned in the session or of kind "pc"):
 * PlayerView / PlayerSight are given assignments where each viewer definition belongs to USER and
 * nothing else belongs to anyone, so players_see_other_pcs never hides a PC from the table, and a
 * non-viewer token is seen only inside the scope. Scope: FogStrictScope::forTable().
 */
final class TableView
{
    /** The virtual owner of the viewers (no account has the id 0). */
    public const USER = 0;

    public function __construct(private SessionSceneQueries $queries, private FogStrictScope $scopes)
    {
    }

    /**
     * Assignments as the table sees them: viewer definition id => USER.
     *
     * @return array<int, int>
     */
    public function assignments(SessionContext $ctx): array
    {
        return array_fill_keys($this->queries->tableDefinitions($ctx->session->id, $ctx->session->gameId), self::USER);
    }

    public function scope(SessionContext $ctx, int $mapId): FogScope
    {
        return $this->scopes->forTable($ctx, $mapId);
    }

    /**
     * uids of the placed table viewers of the map (every floor).
     *
     * @return list<string>
     */
    public function viewers(SessionContext $ctx, int $mapId): array
    {
        return array_column($this->queries->tablePlaced($ctx->session->id, $mapId), 'uid');
    }
}
