<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions;

defined('JDR_BOOT') || exit;

use JDR\Realtime\Audience;
use JDR\Realtime\Channel;

/**
 * The virtual recipient "table" of a FanoutBatch (etapes P07b D6), created by EventFanout::begin()
 * only when the session has at least one active projection screen: its PlayerSight (assignments of
 * TableView: every viewer definition belongs to TableView::USER), its scope (FogStrictScope::
 * forTable, read when the batch began, then by rescope()), and the writing of its versions for the
 * audience "displays" with payload.view = "display". Every screen of the session reads that one
 * version.
 */
final class TableAudience
{
    private FogScope $scope;

    /**
     * @param array<int, int> $sessionAssigned assignments of the session (definition id => user id)
     */
    public function __construct(
        private EventFanout $fanout,
        private FogStrictScope $scopes,
        private PlayerSight $sight,
        private SessionContext $ctx,
        private int $mapId,
        private array $viewerDefinitions,
        private array $sessionAssigned,
        private ?int $actor,
        private ?string $opId,
    ) {
        $this->scope = $scopes->forTable($ctx, $mapId);
    }

    public function sight(): PlayerSight
    {
        return $this->sight;
    }

    public function scope(): FogScope
    {
        return $this->scope;
    }

    /**
     * Reads the scope again.
     *
     * @return array{0: FogScope, 1: FogScope} [old, new]
     */
    public function rescope(): array
    {
        $old = $this->scope;
        $this->scope = $this->scopes->forTable($this->ctx, $this->mapId);

        return [$old, $this->scope];
    }

    /**
     * Must the batch read the table scope again by itself after this placed-token change? Yes for
     * a viewer that is not assigned in the session (a free "pc"): the callers only refresh the
     * scopes when an assigned token moves (FanoutBatch::refreshScopes then covers the table).
     *
     * @param array<string, mixed>|null $before
     * @param array<string, mixed>|null $after
     */
    public function ownRefresh(?array $before, ?array $after): bool
    {
        $token = $after ?? $before;
        if ($token === null || !$this->ctx->fogStrict()) {
            return false;
        }
        $definition = (int) $token['token_id'];
        if (!isset($this->viewerDefinitions[$definition]) || isset($this->sessionAssigned[$definition])) {
            return false;
        }
        $place = static fn (?array $t): ?array => $t === null ? null : [(string) $t['floor'], $t['x'], $t['y'], $t['hidden'] === true];

        return $place($before) !== $place($after);
    }

    /**
     * Writes the table versions for the audience "displays" (payload.view = "display").
     *
     * @param list<array{0: string, 1: array<string, mixed>}> $events
     */
    public function emit(array $events): void
    {
        foreach ($events as [$type, $payload]) {
            $this->record($type, $payload + ['view' => EventFanout::VIEW_DISPLAY], false);
        }
    }

    /**
     * The same payload as the players' (camera.moved), for the audience "displays".
     *
     * @param array<string, mixed> $payload
     */
    public function raw(string $type, array $payload, bool $ephemeral): void
    {
        $this->record($type, $payload, $ephemeral);
    }

    /**
     * @param array<string, mixed> $payload
     */
    private function record(string $type, array $payload, bool $ephemeral): void
    {
        $this->fanout->record(Channel::session($this->ctx->session->id), $type, Audience::DISPLAYS, $payload, null, $this->actor, $this->opId, $ephemeral);
    }
}
