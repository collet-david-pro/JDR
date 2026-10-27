<?php

declare(strict_types=1);

namespace JDR\Domain\Displays;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Errors\NotFoundException;
use JDR\Core\Errors\ValidationException;
use JDR\Core\Request;
use JDR\Core\Session\CookieJar;
use JDR\Core\Session\CookieParams;
use JDR\Domain\Sessions\Session;
use JDR\Domain\Sessions\SessionPresenter;
use JDR\Domain\Sessions\SessionRepository;
use JDR\Domain\Support\Dates;
use JDR\Realtime\EventReader;

/**
 * What a projection screen does for itself (contract P7a): pair with a code, read its state,
 * change its own display settings, unpair. Cookie renewal: GET /display/me sets the same cookie
 * again with a fresh 30-day expiry when the screen was paired more than a day ago (paired_at is
 * the reference, nothing else is stored).
 */
final class DisplayDevice
{
    public const TOUCH_SECONDS = 20;

    public function __construct(
        private DisplayRepository $displays,
        private SessionRepository $sessions,
        private DisplayEvents $events,
        private PairingCode $codes,
        private EventReader $reader,
        private CookieJar $cookies,
        private Clock $clock,
        private SessionPresenter $presenter,
    ) {
    }

    /**
     * POST /display/pair {code}: the cookie is set once the transaction is committed.
     *
     * @param array<array-key, mixed> $body
     * @return array{display: array<string, mixed>}
     * @throws ValidationException display_code_invalid (unknown, expired, used, malformed, ended session)
     */
    public function pair(Request $request, array $body, CookieParams $params, string $apiBase): array
    {
        $code = PairingCode::normalize($body['code'] ?? null);
        if ($code === null) {
            throw self::invalidCode();
        }
        $token = DisplayAuth::newToken();
        $display = $this->displays->db()->transaction(function () use ($request, $code, $token): Display {
            $hash = $this->codes->hash($code);
            $id = null;
            foreach ($this->displays->pendingCodes($this->clock->sql(), true) as $row) {
                if (hash_equals($row['hash'], $hash)) {
                    $id = $row['id'];
                }
            }
            $display = $id === null ? null : $this->displays->find($id, true);
            $session = $display === null ? null : $this->sessions->find($display->sessionId);
            if ($display === null || $display->state !== Display::PENDING || $session === null || $session->isEnded()) {
                throw self::invalidCode();
            }
            $now = $this->clock->sql();
            $ua = $request->header('user-agent');
            $this->displays->update($display->id, [
                'state' => Display::ACTIVE,
                'pairing_code_hash' => null,
                'pairing_expires_at' => null,
                'device_token_hash' => DisplayAuth::hashToken($token),
                'paired_at' => $now,
                'last_seen_at' => $now,
                'last_ip' => $request->ip() === '' ? null : substr($request->ip(), 0, 45),
                'user_agent' => $ua === null || $ua === '' ? null : mb_substr($ua, 0, 255, 'UTF-8'),
            ]);
            $paired = $this->displays->find($display->id) ?? throw new NotFoundException();
            $this->events->paired($paired);

            return $paired;
        });
        $this->setCookie($token, $params);

        return ['display' => $this->me($display, $apiBase)];
    }

    /**
     * GET /display/me: state of the screen; touches last_seen_at (at most every 20 s) and renews the cookie.
     *
     * @return array<string, mixed> DisplayMe
     */
    public function current(Request $request, Display $display, CookieParams $params, string $apiBase): array
    {
        $now = $this->clock->timestamp();
        $seen = Dates::timestamp($display->lastSeenAt);
        if ($seen === null || $now - $seen >= self::TOUCH_SECONDS) {
            $ua = $request->header('user-agent');
            $this->displays->update($display->id, [
                'last_seen_at' => $this->clock->sql(),
                'last_ip' => $request->ip() === '' ? null : substr($request->ip(), 0, 45),
                'user_agent' => $ua === null || $ua === '' ? $display->userAgent : mb_substr($ua, 0, 255, 'UTF-8'),
            ]);
        }
        $paired = Dates::timestamp($display->pairedAt);
        $token = $request->cookies[DisplayAuth::COOKIE] ?? null;
        if (is_string($token) && $paired !== null && $now - $paired > DisplayAuth::RENEW_AFTER) {
            $this->setCookie($token, $params);
        }

        return $this->me($display, $apiBase);
    }

    /**
     * PATCH /display/me {settings}: only diagonal_in, px_per_mm, rotation, mirror.
     *
     * @param array<array-key, mixed> $body
     * @return array<string, mixed> DisplayMe
     */
    public function patch(Display $display, array $body, string $apiBase): array
    {
        $patch = $body['settings'] ?? null;
        $updated = $this->displays->db()->transaction(function () use ($display, $patch): Display {
            $locked = $this->displays->find($display->id, true) ?? throw new NotFoundException();
            $settings = DisplaySettings::patch($locked->settings, $patch, DisplaySettings::DEVICE_KEYS, []);
            $this->displays->update($locked->id, ['settings' => $settings]);
            $new = $this->displays->find($locked->id) ?? $locked;
            $this->events->updated($new, null);

            return $new;
        });

        return $this->me($updated, $apiBase);
    }

    /**
     * POST /display/unpair: revokes the screen (event, then the row is deleted) and clears the cookie.
     */
    public function unpair(Display $display, CookieParams $params): void
    {
        $this->displays->db()->transaction(function () use ($display): void {
            $locked = $this->displays->find($display->id, true);
            if ($locked !== null) {
                $this->events->revoked($locked, null);
                $this->displays->delete($locked->id);
            }
        });
        $this->cookies->set(DisplayAuth::COOKIE, '', 1, $params->path, $params->secure, 'Strict');
    }

    /**
     * DisplayMe. Never the session code, the players or the assignments. pause_screen carries the
     * signed URL of its image (P7b D11).
     *
     * @return array<string, mixed>
     */
    public function me(Display $display, string $apiBase): array
    {
        $head = $this->reader->headId();
        $display = $this->displays->find($display->id) ?? $display;
        $session = $this->sessions->find($display->sessionId) ?? throw new NotFoundException();

        return [
            'id' => $display->id,
            'name' => $display->name,
            'settings' => $display->settings,
            'session' => [
                'id' => $session->id,
                'game_id' => $session->gameId,
                'name' => $session->name,
                'state' => $session->state,
                'current_map_id' => $session->currentMapId,
                'current_floor_id' => $session->currentFloorId,
                'camera' => $session->camera,
                'pause_screen' => $this->presenter->pauseScreen($session->pauseScreen, $apiBase),
            ],
            // 'waiting' is only a defensive fallback: ending a session revokes its screens (P7g), so a
            // screen normally never reads an ended session (race between the end and this read).
            'status' => $session->state === Session::ENDED ? 'waiting' : $session->state,
            'last_event_id' => (string) $head,
        ];
    }

    private function setCookie(string $token, CookieParams $params): void
    {
        $this->cookies->set(DisplayAuth::COOKIE, $token, $this->clock->timestamp() + DisplayAuth::LIFETIME, $params->path, $params->secure, 'Strict');
    }

    private static function invalidCode(): ValidationException
    {
        return new ValidationException('', [], 'display_code_invalid');
    }
}
