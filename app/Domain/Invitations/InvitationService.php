<?php

declare(strict_types=1);

namespace JDR\Domain\Invitations;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Errors\ValidationException;
use JDR\Domain\Support\Dates;
use JDR\Domain\Support\Links;

/**
 * Invitation codes (registration_mode = invite): random, stored hashed (SHA-256), limited uses,
 * optional expiry and optional addressee (nominative invitation).
 */
final class InvitationService
{
    private const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    private const CODE_LENGTH = 20;

    public function __construct(
        private InvitationRepository $invitations,
        private Clock $clock,
        private Links $links,
    ) {
    }

    /**
     * @return array{invitation: array<string, mixed>, code: string, url: string}
     */
    public function create(int $createdBy, ?string $email, int $maxUses, ?int $expiresInDays): array
    {
        $code = self::randomCode();
        $now = $this->clock->timestamp();
        $id = $this->invitations->insert(
            self::hash($code),
            $email,
            $createdBy,
            $maxUses,
            $expiresInDays === null ? null : Dates::sql($now + $expiresInDays * 86400),
            Dates::sql($now),
        );
        $row = $this->invitations->find($id) ?? [];

        return ['invitation' => self::present($row), 'code' => $code, 'url' => $this->links->invitation($code)];
    }

    /**
     * @return array{valid: bool, email: string|null}
     */
    public function check(string $code): array
    {
        $row = $this->invitations->findByHash(self::hash(self::normalize($code)));
        if ($row === null || !$this->usable($row)) {
            return ['valid' => false, 'email' => null];
        }

        return ['valid' => true, 'email' => $row['email'] === null ? null : (string) $row['email']];
    }

    /**
     * Uses one slot of the invitation (inside the registration transaction).
     *
     * @throws ValidationException invitation_code invalid, or email mismatch for a nominative invitation
     */
    public function consume(string $code, string $email): int
    {
        $row = $this->invitations->findByHash(self::hash(self::normalize($code)), true);
        if ($row === null || !$this->usable($row)) {
            throw new ValidationException('', ['invitation_code' => 'invalid']);
        }
        if ($row['email'] !== null && mb_strtolower((string) $row['email'], 'UTF-8') !== $email) {
            throw new ValidationException('', ['email' => 'mismatch']);
        }
        $this->invitations->incrementUses((int) $row['id']);

        return (int) $row['id'];
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function list(): array
    {
        return array_map(static fn (array $r): array => self::present($r), $this->invitations->all());
    }

    public function delete(int $id): bool
    {
        return $this->invitations->delete($id);
    }

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    public static function present(array $row): array
    {
        return [
            'id' => (int) ($row['id'] ?? 0),
            'email' => isset($row['email']) ? (string) $row['email'] : null,
            'max_uses' => (int) ($row['max_uses'] ?? 1),
            'uses' => (int) ($row['uses'] ?? 0),
            'expires_at' => Dates::iso($row['expires_at'] ?? null),
            'created_at' => Dates::iso($row['created_at'] ?? null),
            'created_by' => isset($row['created_by']) ? (string) $row['created_by'] : null,
        ];
    }

    public static function normalize(string $code): string
    {
        return strtoupper((string) preg_replace('/[\s-]+/', '', $code));
    }

    private static function hash(string $code): string
    {
        return hash('sha256', $code);
    }

    /**
     * @param array<string, mixed> $row
     */
    private function usable(array $row): bool
    {
        if ((int) $row['uses'] >= (int) $row['max_uses']) {
            return false;
        }
        $expires = Dates::timestamp($row['expires_at']);

        return $expires === null || $expires > $this->clock->timestamp();
    }

    private static function randomCode(): string
    {
        $code = '';
        $max = strlen(self::ALPHABET) - 1;
        for ($i = 0; $i < self::CODE_LENGTH; $i++) {
            $code .= self::ALPHABET[random_int(0, $max)];
        }

        return $code;
    }
}
