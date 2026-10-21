<?php

declare(strict_types=1);

namespace JDR\Domain\Assets;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Signer;

/**
 * Signed file URLs (projet.md 9.3): {api_base}/files/{uuid}?t=full|thumb&e=<expiry>&s=<HMAC(uuid|t|e)>.
 * The expiry is rounded to the next day + 1 day: the URL is stable for the whole day.
 * Only built for someone allowed to see the asset (checked by the caller).
 */
final class AssetUrls
{
    public const TYPES = ['full', 'thumb'];

    public function __construct(private Signer $signer, private Clock $clock)
    {
    }

    /**
     * @param string $apiBase Config::apiBase() of the request ("/api/v1" or "/index.php?r=/api/v1")
     */
    public function url(string $apiBase, string $uuid, string $type): string
    {
        $expires = Signer::dailyExpiry($this->clock->timestamp());
        $signature = $this->signer->signWithExpiry($expires, $uuid, $type);
        $separator = str_contains($apiBase, '?') ? '&' : '?';

        return $apiBase . '/files/' . $uuid . $separator . http_build_query(['t' => $type, 'e' => $expires, 's' => $signature]);
    }

    /**
     * @return array{full: string, thumb: string}
     */
    public function pair(string $apiBase, string $uuid): array
    {
        return ['full' => $this->url($apiBase, $uuid, 'full'), 'thumb' => $this->url($apiBase, $uuid, 'thumb')];
    }

    public function verify(string $uuid, mixed $type, mixed $expires, mixed $signature): bool
    {
        if (!is_string($type) || !in_array($type, self::TYPES, true)
            || !is_string($expires) || !ctype_digit($expires) || strlen($expires) > 12
            || !is_string($signature) || $signature === '') {
            return false;
        }

        return $this->signer->verifyWithExpiry($signature, (int) $expires, $this->clock->timestamp(), $uuid, $type);
    }
}
