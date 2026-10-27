<?php

declare(strict_types=1);

namespace JDR\Realtime;

defined('JDR_BOOT') || exit;

/**
 * What a reader may read: its channels (1 to 4) with its role on each (ChannelAuthorizer).
 * userId = the reader account (null for a projection screen, P7: displayId instead; clientIp /
 * userAgent of its request, for its last_seen_at). close(): a LoopListener ends the read (screen
 * revoked, moved or session ended, P7b D7); the SSE / long-polling loops stop at their next
 * iteration.
 */
final class Subscription
{
    /** @var array<string, ChannelGrant> channel => grant (request order) */
    public readonly array $grants;
    private bool $closed = false;

    /**
     * @param list<ChannelGrant> $grants
     */
    public function __construct(
        public readonly ?int $userId,
        array $grants,
        public readonly ?int $displayId = null,
        public readonly ?string $clientIp = null,
        public readonly ?string $userAgent = null,
    ) {
        if ($grants === []) {
            throw new \InvalidArgumentException('A subscription needs at least one channel.');
        }
        $byChannel = [];
        foreach ($grants as $grant) {
            $byChannel[$grant->channel] = $grant;
        }
        $this->grants = $byChannel;
    }

    /**
     * @return list<string>
     */
    public function channels(): array
    {
        return array_keys($this->grants);
    }

    public function roleOn(string $channel): ?string
    {
        return ($this->grants[$channel] ?? null)?->role;
    }

    /**
     * Grants whose role is $role (e.g. the session channels this user runs, for presence).
     *
     * @return list<ChannelGrant>
     */
    public function grantsWithRole(string $role): array
    {
        return array_values(array_filter($this->grants, static fn (ChannelGrant $g): bool => $g->role === $role));
    }

    public function close(): void
    {
        $this->closed = true;
    }

    public function isClosed(): bool
    {
        return $this->closed;
    }
}
