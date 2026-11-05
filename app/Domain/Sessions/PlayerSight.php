<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions;

defined('JDR_BOOT') || exit;

use JDR\Domain\Maps\Map;
use JDR\Maps\ObjectRules;
use JDR\Maps\ObjectRulesNotes;

/**
 * The version of one placed token / object a player sees (PlayerView, PlayerFilter) under a
 * scope, during a FanoutBatch: assignments, revealed objects and hidden tokens of the map, kept up
 * to date by the batch. null = he does not see it.
 */
final class PlayerSight
{
    /** Read at the first object that depends on a note (setNotes() after a change). */
    private ?NoteVisibility $notes = null;

    /**
     * @param array<int, int>     $assignments  token definition id => user id
     * @param array<string, true> $revealed     uids of the revealed objects
     * @param array<string, true> $hiddenTokens uids of the hidden placed tokens
     */
    public function __construct(
        private PlayerView $view,
        private SessionContext $ctx,
        private Map $map,
        private array $assignments,
        private array $revealed,
        private array $hiddenTokens,
    ) {
    }

    /**
     * @param array<string, mixed> $token API form
     * @return array<string, mixed>|null
     */
    public function token(array $token, int $user, FogScope $scope): ?array
    {
        return $this->view->tokens($this->ctx, $user, [$token], $scope, $this->assignments)[0] ?? null;
    }

    /**
     * @param array<string, mixed> $object API form
     * @param bool|null            $revealed null = as stored
     * @param int|null             $user     the reader (a player, TableView::USER); null = sees no note
     * @param NoteVisibility|null  $notes    null = as stored (NoteFanout: before / after a change)
     * @return array<string, mixed>|null
     */
    public function object(array $object, FogScope $scope, ?bool $revealed = null, ?int $user = null, ?NoteVisibility $notes = null): ?array
    {
        $uid = (string) $object['uid'];
        $bboxes = $scope->isRestricted() ? [$uid => ObjectRules::bbox($object, $this->map->width, $this->map->height)] : [];
        $revealed ??= isset($this->revealed[$uid]);
        $follows = $object['props']['follows_token'] ?? null;
        $hidden = is_string($follows) && isset($this->hiddenTokens[$follows]) ? [$follows] : [];

        $visible = $user !== null && ObjectRulesNotes::handles($object['type'] ?? null)
            ? ($notes ?? $this->notes ??= $this->view->noteVisibility($this->map->id))->uidsFor($user)
            : [];

        return $this->view->objects([$object], $revealed ? [$uid] : [], $scope, $bboxes, $hidden, $visible)[0] ?? null;
    }

    /**
     * Sets the note visibility rules used to filter linked notes.
     */
    public function setNotes(NoteVisibility $notes): void
    {
        $this->notes = $notes;
    }

    /**
     * Records that the object is no longer visible to players.
     */
    public function markHidden(string $uid): void
    {
        unset($this->revealed[$uid]);
    }

    /**
     * Records that the object is now visible to players.
     */
    public function markRevealed(string $uid): void
    {
        $this->revealed[$uid] = true;
    }

    /**
     * Records the hidden flag of a placed token after a change (null: the token is gone).
     *
     * @param array<string, mixed>|null $after
     */
    public function tokenChanged(string $uid, ?array $after): void
    {
        if ($after !== null && $after['hidden'] === true) {
            $this->hiddenTokens[$uid] = true;
        } else {
            unset($this->hiddenTokens[$uid]);
        }
    }
}
