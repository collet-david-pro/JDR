<?php

declare(strict_types=1);

namespace JDR\Domain\Displays;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Errors\ConflictException;
use JDR\Core\Errors\NotFoundException;
use JDR\Core\Errors\ValidationException;
use JDR\Domain\Maps\MapRepository;
use JDR\Domain\Sessions\Session;
use JDR\Domain\Sessions\SessionAccess;
use JDR\Domain\Sessions\SessionContext;
use JDR\Domain\Sessions\SessionRepository;
use JDR\Domain\Users\User;

/**
 * Projection screens seen by the GM and co-GMs (contract P7a): creation with a pairing code,
 * list, rename / settings, revocation, new code.
 * Rights: SessionAccess::requireGm on the session of the screen (player 403, non-member 404).
 */
final class DisplayService
{
    public function __construct(
        private DisplayRepository $displays,
        private SessionRepository $sessions,
        private SessionAccess $access,
        private DisplayEvents $events,
        private DisplayPresenter $presenter,
        private PairingCode $codes,
        private MapRepository $maps,
        private Clock $clock,
    ) {
    }

    /**
     * @param array<array-key, mixed> $body {name}
     * @return array<string, mixed> the screen with its "pairing"
     */
    public function create(User $user, int $sessionId, array $body): array
    {
        $this->access->requireGm($user, $sessionId);
        $name = self::name($body['name'] ?? null, true);

        return $this->displays->db()->transaction(function () use ($user, $sessionId, $name): array {
            $this->lockOpenSession($sessionId);
            $this->requireRoom($sessionId);
            [$code, $hash] = $this->freshCode();
            $id = $this->displays->insert(
                $sessionId,
                (string) $name,
                $hash,
                $this->expiry(),
                DisplaySettings::DEFAULTS,
                $this->clock->sql(),
            );
            $display = $this->displays->find($id) ?? throw new \RuntimeException('Display lost after insert.');
            $this->events->updated($display, $user->id, true);

            return $this->presenter->one($display, $code);
        });
    }

    /**
     * @return array{displays: list<array<string, mixed>>}
     */
    public function list(User $user, int $sessionId): array
    {
        $this->access->requireGm($user, $sessionId);

        return [
            'displays' => array_map($this->presenter->one(...), $this->displays->listForSession($sessionId)),
        ];
    }

    /**
     * @param array<array-key, mixed> $body {name?, settings?}
     * @return array<string, mixed>
     */
    public function update(User $user, int $displayId, array $body): array
    {
        $ctx = $this->ownRights($user, $displayId);
        $name = array_key_exists('name', $body) ? self::name($body['name'], false) : null;
        $patch = array_key_exists('settings', $body) ? $body['settings'] : null;
        $floors = $this->floorIds($ctx->session);

        return $this->displays->db()->transaction(function () use ($user, $displayId, $name, $patch, $floors): array {
            $locked = $this->displays->find($displayId, true) ?? throw new NotFoundException();
            $fields = [];
            if ($name !== null) {
                $fields['name'] = $name;
            }
            if ($patch !== null) {
                $fields['settings'] = DisplaySettings::patch($locked->settings, $patch, array_keys(DisplaySettings::DEFAULTS), $floors);
            }
            $this->displays->update($locked->id, $fields);
            $display = $this->displays->find($locked->id) ?? $locked;
            $this->events->updated($display, $user->id);

            return $this->presenter->one($display);
        });
    }

    public function revoke(User $user, int $displayId): void
    {
        $this->ownRights($user, $displayId);
        $this->displays->db()->transaction(function () use ($user, $displayId): void {
            $display = $this->displays->find($displayId, true) ?? throw new NotFoundException();
            $this->events->revoked($display, $user->id);
            $this->displays->delete($display->id);
        });
    }

    /**
     * @return array<string, mixed> the screen with its new "pairing"
     */
    public function regenerateCode(User $user, int $displayId): array
    {
        $this->ownRights($user, $displayId);

        return $this->displays->db()->transaction(function () use ($displayId): array {
            $display = $this->displays->find($displayId, true) ?? throw new NotFoundException();
            if ($display->state !== Display::PENDING) {
                throw new ConflictException('', ['state' => $display->state], 'display_not_pending');
            }
            $this->lockOpenSession($display->sessionId);
            [$code, $hash] = $this->freshCode();
            $this->displays->update($display->id, ['pairing_code_hash' => $hash, 'pairing_expires_at' => $this->expiry()]);

            return $this->presenter->one($this->displays->find($display->id) ?? $display, $code);
        });
    }

    /**
     * Rights on the session of a screen. An unknown screen is a 404.
     */
    private function ownRights(User $user, int $displayId): SessionContext
    {
        return $this->access->requireGm($user, $this->requireDisplay($displayId)->sessionId);
    }

    private function requireDisplay(int $id): Display
    {
        return $this->displays->find($id) ?? throw new NotFoundException();
    }

    /**
     * Locks the session row; refuses an ended one (409 invalid_transition).
     */
    private function lockOpenSession(int $sessionId): Session
    {
        $session = $this->sessions->findForUpdate($sessionId) ?? throw new NotFoundException();
        if ($session->isEnded()) {
            throw new ConflictException('', ['state' => $session->state], 'invalid_transition');
        }

        return $session;
    }

    private function requireRoom(int $sessionId): void
    {
        if ($this->displays->countForSession($sessionId) >= Display::MAX_PER_SESSION) {
            throw new ConflictException('', ['max' => (string) Display::MAX_PER_SESSION], 'display_limit');
        }
    }

    /**
     * A code not used by any live pending screen of the site: [code, hash].
     *
     * @return array{0: string, 1: string}
     */
    private function freshCode(): array
    {
        $taken = array_column($this->displays->pendingCodes($this->clock->sql(), true), 'hash');
        for ($i = 0; $i < 5; $i++) {
            $code = $this->codes->generate();
            $hash = $this->codes->hash($code);
            if (!in_array($hash, $taken, true)) {
                return [$code, $hash];
            }
        }

        throw new \RuntimeException('No free pairing code after 5 tries.');
    }

    private function expiry(): string
    {
        return gmdate('Y-m-d H:i:s', $this->clock->timestamp() + PairingCode::LIFETIME);
    }

    /**
     * @return list<string>
     */
    private function floorIds(Session $session): array
    {
        if ($session->currentMapId === null) {
            return [];
        }

        return array_map(static fn (array $f): string => (string) $f['id'], $this->maps->floors($session->currentMapId));
    }

    /**
     * @throws ValidationException
     */
    public static function name(mixed $raw, bool $required): ?string
    {
        if ($raw === null && !$required) {
            throw new ValidationException('', ['name' => 'invalid']);
        }
        $name = is_string($raw) ? trim($raw) : '';
        $length = mb_strlen($name, 'UTF-8');
        if ($length < 1 || $length > 60) {
            throw new ValidationException('', ['name' => $raw === null ? 'required' : 'invalid']);
        }

        return $name;
    }
}
