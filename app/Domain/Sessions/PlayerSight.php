<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions;

defined('JDR_BOOT') || exit;

use JDR\Domain\Maps\Map;
use JDR\Maps\ObjectRules;

/**
 * The version of one placed token / object a player sees (PlayerView, PlayerFilter) under a
 * scope, during a FanoutBatch: assignments, revealed objects and hidden tokens of the map, kept up
 * to date by the batch. null = he does not see it.
 */
final class PlayerSight
{
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
     * @return array<string, mixed>|null
     */
    public function object(array $object, FogScope $scope, ?bool $revealed = null): ?array
    {
        $uid = (string) $object['uid'];
        $bboxes = $scope->isRestricted() ? [$uid => ObjectRules::bbox($object, $this->map->width, $this->map->height)] : [];
        $revealed ??= isset($this->revealed[$uid]);
        $follows = $object['props']['follows_token'] ?? null;
        $hidden = is_string($follows) && isset($this->hiddenTokens[$follows]) ? [$follows] : [];

        return $this->view->objects([$object], $revealed ? [$uid] : [], $scope, $bboxes, $hidden)[0] ?? null;
    }

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
