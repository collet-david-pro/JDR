<?php

declare(strict_types=1);

namespace JDR\Domain\Displays;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Domain\Support\Dates;
use JDR\Domain\Support\Links;

/**
 * JSON objects of a screen: the GM object (contract P7a "Objet écran"), the same without its
 * pairing (events to the GM) and the trimmed one sent to the screens themselves.
 */
final class DisplayPresenter
{
    public function __construct(private Clock $clock, private Links $links)
    {
    }

    /**
     * @param string|null $code clear pairing code (creation / regeneration only)
     * @return array<string, mixed>
     */
    public function one(Display $d, ?string $code = null): array
    {
        $pairing = null;
        if ($code !== null) {
            $pairing = [
                'code' => $code,
                'expires_at' => Dates::iso($d->pairingExpiresAt),
                'url' => $this->links->page('/display?c=' . $code),
            ];
        }

        return $this->withoutPairing($d) + ['pairing' => $pairing];
    }

    /**
     * @return array<string, mixed> the GM object without the "pairing" key (event payloads)
     */
    public function withoutPairing(Display $d): array
    {
        return [
            'id' => $d->id,
            'session_id' => $d->sessionId,
            'name' => $d->name,
            'state' => $d->state,
            'online' => $this->online($d),
            'last_seen_at' => Dates::iso($d->lastSeenAt),
            'paired_at' => Dates::iso($d->pairedAt),
            'user_agent' => $d->userAgent,
            'settings' => $d->settings,
        ];
    }

    /**
     * @return array<string, mixed> what the other screens may know (no device details)
     */
    public function forDisplays(Display $d): array
    {
        return array_diff_key($this->withoutPairing($d), array_flip(['user_agent', 'last_seen_at', 'paired_at', 'online']));
    }

    public function online(Display $d): bool
    {
        $seen = Dates::timestamp($d->lastSeenAt);

        return $seen !== null && $this->clock->timestamp() - $seen < Display::ONLINE_SECONDS;
    }
}
