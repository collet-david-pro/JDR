<?php

declare(strict_types=1);

namespace JDR\Domain\Encounters;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\NotFoundException;
use JDR\Core\Errors\ValidationException;
use JDR\Domain\Games\Fields;
use JDR\Domain\Games\Game;
use JDR\Domain\Games\GamePolicy;
use JDR\Domain\Tokens\TokenRepository;
use JDR\Domain\Users\User;

/**
 * Prepared encounters (contract P3): GM / co-GM only (a player gets 403: GM preparation),
 * non-members 404. Validation: name 1-120, notes at most 10000 (blank => null), at most 100
 * tokens, each once, live tokens of the same game, dx/dy within ±9999.999 cells (DECIMAL(7,3)).
 */
final class EncounterService
{
    public const NAME_MAX = 120;
    public const NOTES_MAX = 10000;
    public const TOKENS_MAX = 100;
    public const OFFSET_MAX = 9999.999;

    public function __construct(
        private EncounterRepository $encounters,
        private GamePolicy $games,
        private TokenRepository $tokens,
    ) {
    }

    /**
     * @return list<Encounter>
     */
    public function listFor(User $user, int $gameId): array
    {
        return $this->encounters->listForGame($this->games->requireEdit($user, $gameId)->id);
    }

    /**
     * @param array<array-key, mixed> $body
     */
    public function create(User $user, int $gameId, array $body): Encounter
    {
        $game = $this->games->requireEdit($user, $gameId);
        $errors = [];
        if (!array_key_exists('name', $body)) {
            $errors['name'] = 'required';
        }
        $values = $this->read($body, $game, $errors);
        if ($errors !== []) {
            throw new ValidationException('', $errors);
        }
        $id = $this->encounters->insert($game->id, (string) $values['name'], $values['notes'] ?? null, $values['tokens'] ?? []);

        return $this->encounters->find($id) ?? throw new \RuntimeException('Encounter lost after insert.');
    }

    /**
     * @param array<array-key, mixed> $body
     */
    public function update(User $user, int $encounterId, array $body): Encounter
    {
        [$encounter, $game] = $this->editable($user, $encounterId);
        $errors = [];
        $changes = $this->read($body, $game, $errors);
        if ($errors !== []) {
            throw new ValidationException('', $errors);
        }
        /** @var array{name?: string, notes?: ?string, tokens?: list<array{token_id: int, dx: int|float, dy: int|float}>} $changes */
        $this->encounters->update($encounter->id, $changes);

        return $this->encounters->find($encounter->id) ?? $encounter;
    }

    public function delete(User $user, int $encounterId): void
    {
        [$encounter] = $this->editable($user, $encounterId);
        $this->encounters->delete($encounter->id);
    }

    /**
     * POST /encounters/{id}/place: rights checked, then 404 until maps exist (P4).
     *
     * @throws NotFoundException
     */
    public function place(User $user, int $encounterId): never
    {
        $this->editable($user, $encounterId);
        throw new NotFoundException();
    }

    /**
     * @return array{0: Encounter, 1: Game}
     */
    private function editable(User $user, int $encounterId): array
    {
        $encounter = $this->encounters->find($encounterId) ?? throw new NotFoundException();

        return [$encounter, $this->games->requireEdit($user, $encounter->gameId)];
    }

    /**
     * @param array<array-key, mixed> $body
     * @param array<string, string>   $errors
     * @return array<string, mixed>
     */
    private function read(array $body, Game $game, array &$errors): array
    {
        $out = [];
        if (array_key_exists('name', $body)) {
            $name = $body['name'] === null ? null : Fields::text($body['name'], PHP_INT_MAX);
            if ($body['name'] === null || $name === '') {
                $errors['name'] = 'required';
            } elseif ($name === null) {
                $errors['name'] = 'invalid';
            } elseif (mb_strlen($name, 'UTF-8') > self::NAME_MAX) {
                $errors['name'] = 'too_long';
            } else {
                $out['name'] = $name;
            }
        }
        if (array_key_exists('notes', $body)) {
            $notes = $body['notes'] === null ? '' : Fields::text($body['notes'], PHP_INT_MAX, true);
            if ($notes === null) {
                $errors['notes'] = 'invalid';
            } elseif (mb_strlen($notes, 'UTF-8') > self::NOTES_MAX) {
                $errors['notes'] = 'too_long';
            } else {
                $out['notes'] = $notes === '' ? null : $notes;
            }
        }
        if (array_key_exists('tokens', $body)) {
            $tokens = $this->tokensOf($body['tokens'], $game, $errors);
            if ($tokens !== null) {
                $out['tokens'] = $tokens;
            }
        }

        return $out;
    }

    /**
     * @param array<string, string> $errors
     * @return list<array{token_id: int, dx: int|float, dy: int|float}>|null
     */
    private function tokensOf(mixed $value, Game $game, array &$errors): ?array
    {
        if (!is_array($value) || !array_is_list($value)) {
            $errors['tokens'] = 'invalid';

            return null;
        }
        if (count($value) > self::TOKENS_MAX) {
            $errors['tokens'] = 'too_large';

            return null;
        }
        $out = [];
        foreach ($value as $item) {
            $item = Fields::object($item, ['token_id', 'dx', 'dy']);
            $id = $item === null ? null : Fields::id($item['token_id'] ?? null);
            $dx = $item === null ? null : Fields::number($item['dx'] ?? null, -self::OFFSET_MAX, self::OFFSET_MAX);
            $dy = $item === null ? null : Fields::number($item['dy'] ?? null, -self::OFFSET_MAX, self::OFFSET_MAX);
            if ($id === null || $dx === null || $dy === null || isset($out[$id])) {
                $errors['tokens'] = 'invalid';

                return null;
            }
            $out[$id] = ['token_id' => $id, 'dx' => $dx, 'dy' => $dy];
        }
        $live = $this->tokens->liveIdsInGame($game->id, array_keys($out));
        if (count($live) !== count($out)) {
            $errors['tokens'] = 'not_found';

            return null;
        }

        return array_values($out);
    }
}
