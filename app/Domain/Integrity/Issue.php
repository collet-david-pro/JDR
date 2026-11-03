<?php

declare(strict_types=1);

namespace JDR\Domain\Integrity;

defined('JDR_BOOT') || exit;

/**
 * One integrity problem (projet.md 8.5). The id is stable ("kind:subject") and identifies it for the fix.
 */
final class Issue
{
    /** kind => [action, destructive] ; null = no automatic correction */
    public const FIXES = [
        'quota_mismatch' => ['recalc_quota', false],
        'size_mismatch' => ['fix_sizes', false],
        'asset_refs_mismatch' => ['recalc_refs', false],
        'revision_ahead' => ['raise_revision', false],
        'missing_file' => ['delete_asset', true],
        'orphan_file' => ['delete_file', true],
        'undecodable_chunk' => ['delete_chunk', true],
        'undecodable_fog' => ['delete_fog', true],
        'ref_to_deleted_asset' => null,
    ];

    /**
     * @param array<string, mixed> $subject
     * @param array<string, mixed> $details
     */
    public function __construct(
        public readonly string $kind,
        public readonly string $key,
        public readonly string $severity,
        public readonly array $subject,
        public readonly array $details = [],
    ) {
    }

    public function id(): string
    {
        return $this->kind . ':' . $this->key;
    }

    public static function destructive(string $kind): bool
    {
        return (self::FIXES[$kind][1] ?? false) === true;
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        $fix = self::FIXES[$this->kind] ?? null;

        return [
            'id' => $this->id(),
            'kind' => $this->kind,
            'severity' => $this->severity,
            'subject' => $this->subject,
            'details' => $this->details === [] ? new \stdClass() : $this->details,
            'fix' => $fix === null ? null : ['action' => $fix[0], 'destructive' => $fix[1]],
        ];
    }
}
