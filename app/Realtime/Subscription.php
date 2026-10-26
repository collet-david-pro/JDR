<?php

declare(strict_types=1);

namespace JDR\Realtime;

defined('JDR_BOOT') || exit;

/**
 * What a reader may read: its channels (1 to 4) with its role on each (ChannelAuthorizer).
 * userId = the reader account (null for a projection screen, P7: displayId instead).
 */
final class Subscription
{
    /** @var array<string, ChannelGrant> channel => grant (request order) */
    public readonly array $grants;

    /**
     * @param list<ChannelGrant> $grants
     */
    public function __construct(public readonly ?int $userId, array $grants, public readonly ?int $displayId = null)
    {
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
}
