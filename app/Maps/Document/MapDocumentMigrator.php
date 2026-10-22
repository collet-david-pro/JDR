<?php

declare(strict_types=1);

namespace JDR\Maps\Document;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\ValidationException;

/**
 * Format migrations of the map document (projet.md 8.2 and 12.1): a document of an older
 * format_version is migrated on the fly, one step at a time (migrate_vN_to_vN+1, here
 * migrateV{N}ToV{N+1}), before validation. A newer format_version is refused
 * (422 unsupported_format_version): this server cannot know what it means.
 *
 * Only format 1 exists today: no step yet. Every future step must come with a fixture of the
 * previous version in tests/fixtures/maps/ (non-regression) and the same step on the client
 * (frontend/src/formats/map-document*.ts).
 */
final class MapDocumentMigrator
{
    public const CURRENT = 1;

    /** @var array<int, \Closure(array<string, mixed>): array<string, mixed>> from version => step */
    private array $steps;

    /**
     * @param array<int, \Closure(array<string, mixed>): array<string, mixed>>|null $steps tests only
     */
    public function __construct(private int $current = self::CURRENT, ?array $steps = null)
    {
        $this->steps = $steps ?? self::defaultSteps();
    }

    public function current(): int
    {
        return $this->current;
    }

    /**
     * Version declared by a decoded document.
     *
     * @param array<array-key, mixed> $doc
     * @throws ValidationException format_version invalid | unsupported_format_version
     */
    public function versionOf(array $doc): int
    {
        $version = $doc['format_version'] ?? null;
        if (is_float($version) && floor($version) === $version && abs($version) < 1.0E9) {
            $version = (int) $version;
        }
        if (!is_int($version) || $version < 1) {
            throw new ValidationException('', ['format_version' => array_key_exists('format_version', $doc) ? 'invalid' : 'required']);
        }
        if ($version > $this->current) {
            throw new ValidationException('', ['format_version' => 'unsupported'], 'unsupported_format_version');
        }

        return $version;
    }

    /**
     * Migrates a decoded document up to the current version.
     *
     * @param array<array-key, mixed> $doc
     * @return array<array-key, mixed> document with format_version = current
     * @throws ValidationException
     */
    public function migrate(array $doc): array
    {
        $version = $this->versionOf($doc);
        while ($version < $this->current) {
            $step = $this->steps[$version] ?? throw new \LogicException('Missing map document migration from v' . $version);
            $doc = $step($doc);
            $version++;
            $doc['format_version'] = $version;
        }

        return $doc;
    }

    /**
     * @return array<int, \Closure(array<string, mixed>): array<string, mixed>>
     */
    private static function defaultSteps(): array
    {
        // Example for the next format: 1 => self::migrateV1ToV2(...),
        return [];
    }
}
