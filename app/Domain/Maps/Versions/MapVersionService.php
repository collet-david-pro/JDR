<?php

declare(strict_types=1);

namespace JDR\Domain\Maps\Versions;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Db;
use JDR\Core\Errors\NotFoundException;
use JDR\Core\Errors\ValidationException;
use JDR\Core\Logger;
use JDR\Domain\Games\Fields;
use JDR\Domain\Maps\Map;
use JDR\Domain\Maps\MapOpsInput;
use JDR\Domain\Maps\MapPolicy;
use JDR\Domain\Maps\MapRepository;
use JDR\Domain\Support\Dates;
use JDR\Domain\Users\User;
use JDR\Maps\Document\MapDocumentBuilder;
use JDR\Maps\Document\MapDocumentMigrator;
use JDR\Maps\Document\MapDocumentValidator;
use JDR\Maps\Document\MapDocumentWriter;
use JDR\Maps\Document\PaletteResolver;

/**
 * Map versions (projet.md 11.4 "Versions", contract P4c):
 * - auto: taken by the ops processing (afterOps) when the last auto snapshot (or the map
 *   creation) is more than 5 min old and the map changed since;
 * - manual: on request, with an optional label;
 * - pre_restore: the current state, just before a restore.
 * Snapshot = internal map document (12.1, palette with asset_id, placed tokens with token_id;
 * P5: objects, placed tokens and fog included), JSON gzipped. A restored placed token whose
 * definition is gone (and no live token of the game has its name) is dropped.
 * Restoring writes the snapshot over the map in a NEW revision (history is never rewritten),
 * map_asset_refs recomputed; idempotent by client_op_id (processed_ops).
 */
final class MapVersionService
{
    public const AUTO_INTERVAL_SECONDS = 300;
    public const LABEL_MAX = 120;
    public const CLIENT_KINDS = ['manual', 'pre_generate'];
    public const KINDS = ['auto', 'manual', 'pre_restore', 'pre_generate', 'pre_update'];
    public const GZIP_LEVEL = 6;
    /** Decompressed size bound of a stored snapshot. */
    public const MAX_SNAPSHOT_BYTES = 2 * MapDocumentValidator::MAX_BYTES;
    private const REPLAY_KIND = 'version_restore';

    public function __construct(
        private Db $db,
        private MapRepository $maps,
        private MapPolicy $policy,
        private MapVersionRepository $versions,
        private MapDocumentBuilder $builder,
        private MapDocumentWriter $writer,
        private PaletteResolver $resolver,
        private Clock $clock,
        private Logger $logger,
    ) {
    }

    /**
     * GET /maps/{id}/versions -> MapVersion[] (most recent first).
     *
     * @return list<array<string, mixed>>
     */
    public function list(User $user, int $mapId): array
    {
        [$map] = $this->policy->requireEdit($user, $mapId);

        return array_map(self::present(...), $this->versions->listForMap($map->id));
    }

    /**
     * POST /maps/{id}/versions {label?, kind?: manual|pre_generate} -> MapVersion.
     *
     * @param array<array-key, mixed> $body
     * @return array<string, mixed>
     */
    public function create(User $user, int $mapId, array $body): array
    {
        [$map] = $this->policy->requireEdit($user, $mapId);
        $label = self::label($body['label'] ?? null);
        $kind = $body['kind'] ?? 'manual';
        if (!is_string($kind) || !in_array($kind, self::CLIENT_KINDS, true)) {
            throw new ValidationException('', ['kind' => 'invalid']);
        }
        $id = (int) $this->db->transaction(function () use ($map, $label, $user, $kind): int {
            $locked = $this->maps->findForUpdate($map->id);
            if ($locked === null || $locked->deletedAt !== null) {
                throw new NotFoundException();
            }

            return $this->snapshot($locked, $kind, $label, $user->id);
        });

        return self::present($this->versions->find($map->id, $id) ?? throw new \RuntimeException('Version lost after insert.'));
    }

    /**
     * POST /maps/{id}/versions/{vid}/restore {client_op_id?} -> {revision, map: Map}.
     *
     * @return array{revision: int, map: Map}
     */
    public function restore(User $user, int $mapId, int $versionId, ?string $clientOpId): array
    {
        [$map] = $this->policy->requireEdit($user, $mapId);
        if ($clientOpId !== null && preg_match(MapOpsInput::CLIENT_OP_ID_PATTERN, $clientOpId) !== 1) {
            throw new ValidationException('', ['client_op_id' => 'invalid']);
        }
        if ($clientOpId !== null) {
            $replay = $this->replay($user, $map->id, $versionId, $clientOpId);
            if ($replay !== null) {
                return ['revision' => $replay, 'map' => $this->maps->find($map->id) ?? $map];
            }
        }
        $version = $this->versions->find($map->id, $versionId) ?? throw new NotFoundException();
        $doc = $this->load((int) $version['id']);

        $revision = (int) $this->db->transaction(function () use ($user, $map, $versionId, $clientOpId, $doc): int {
            $locked = $this->maps->findForUpdate($map->id);
            if ($locked === null || $locked->deletedAt !== null) {
                throw new NotFoundException();
            }
            if ($clientOpId !== null) {
                $replay = $this->replay($user, $locked->id, $versionId, $clientOpId);
                if ($replay !== null) {
                    return $replay;
                }
            }
            $this->snapshot($locked, 'pre_restore', null, $user->id);
            $tokens = $this->writer->resolveTokens((int) $locked->gameId, $doc['tokens_placed'], true);
            $revision = $this->writer->replace($locked, $doc, $this->resolvePalette($doc['palette'], $user->id), $tokens['ids']);
            if ($clientOpId !== null) {
                try {
                    $this->maps->rememberProcessed($clientOpId, $user->id, [
                        'kind' => self::REPLAY_KIND,
                        'map_id' => $locked->id,
                        'version_id' => $versionId,
                        'revision' => $revision,
                    ]);
                } catch (\PDOException $e) {
                    if ((string) $e->getCode() !== '23000') {
                        throw $e;
                    }
                    throw new ValidationException('', ['client_op_id' => 'already_used']);
                }
            }

            return $revision;
        });

        return ['revision' => $revision, 'map' => $this->maps->find($map->id) ?? $map];
    }

    /**
     * Hook of the ops processing (inside its transaction, after the lot was written): takes an
     * auto snapshot of the new state when the last auto snapshot (or the map creation) is at least
     * AUTO_INTERVAL_SECONDS old and the map changed since.
     */
    public function afterOps(Map $before, int $revision, int $userId): void
    {
        $last = $this->versions->latest($before->id, 'auto');
        $since = Dates::timestamp($last['created_at'] ?? $before->createdAt) ?? 0;
        if ($this->clock->timestamp() - $since < self::AUTO_INTERVAL_SECONDS || ($last !== null && $last['revision'] >= $revision)) {
            return;
        }
        $map = $this->maps->find($before->id);
        if ($map === null) {
            return;
        }
        try {
            $this->snapshot($map, 'auto', null, $userId);
        } catch (\JsonException $e) {
            $this->logger->warning('Auto snapshot skipped', ['map_id' => $map->id, 'error' => $e->getMessage()]);
        }
    }

    /**
     * Cron "map_versions": retention = the versions_retention most recent auto versions + every
     * manual version + every version younger than 7 days.
     */
    public function trim(int $keepAuto, int $limit = 200): int
    {
        $before = Dates::sql($this->clock->timestamp() - 7 * 86400);
        $count = 0;
        foreach ($this->versions->mapsToTrim($before, max(0, $keepAuto), $limit) as $mapId) {
            $count += $this->versions->trim($mapId, $before, max(0, $keepAuto));
        }

        return $count;
    }

    /**
     * Stores a snapshot of $map (current content, read in the caller's transaction).
     */
    public function snapshot(Map $map, string $kind, ?string $label, ?int $userId): int
    {
        $json = MapDocumentBuilder::encode($this->builder->build($map, true));
        $gz = gzencode($json, self::GZIP_LEVEL);
        if ($gz === false) {
            throw new \RuntimeException('gzencode failed.');
        }

        return $this->versions->insert($map->id, $map->revision, $kind, $label, $gz, $userId);
    }

    /**
     * Decompresses, migrates (re-storing a migrated snapshot) and validates a snapshot.
     *
     * @return array<string, mixed> normalized document
     */
    private function load(int $versionId): array
    {
        $blob = $this->versions->snapshot($versionId) ?? throw new NotFoundException();
        $json = @gzdecode($blob, self::MAX_SNAPSHOT_BYTES);
        if ($json === false) {
            throw new \RuntimeException('Unreadable map snapshot #' . $versionId);
        }
        $raw = MapDocumentValidator::decode($json);
        $migrator = new MapDocumentMigrator();
        if ($migrator->versionOf($raw) < $migrator->current()) {
            $raw = $migrator->migrate($raw);
            $gz = gzencode(MapDocumentBuilder::encode($raw), self::GZIP_LEVEL);
            if ($gz !== false) {
                $this->versions->replaceSnapshot($versionId, $gz);
            }
        }

        return (new MapDocumentValidator($migrator))->validate($raw, true);
    }

    /**
     * Palette of a snapshot: the recorded asset when its row still exists, else the same content
     * (sha256) among the user's / general assets, else an empty slot (index kept).
     *
     * @param list<array<string, mixed>|null> $palette
     * @return list<array{asset_id: int, autotile?: string}|null>
     */
    private function resolvePalette(array $palette, int $userId): array
    {
        $ids = [];
        $hashes = [];
        foreach ($palette as $entry) {
            if ($entry !== null) {
                if (isset($entry['asset_id'])) {
                    $ids[] = $entry['asset_id'];
                }
                $hashes[] = $entry['sha256'];
            }
        }
        $existing = $this->resolver->existing($ids);
        $bySha = $this->resolver->resolve($userId, $hashes);
        $out = [];
        foreach ($palette as $entry) {
            $assetId = $entry === null ? null
                : (isset($entry['asset_id'], $existing[$entry['asset_id']]) ? $entry['asset_id'] : ($bySha[$entry['sha256']] ?? null));
            if ($entry === null || $assetId === null) {
                $out[] = null;
                continue;
            }
            $item = ['asset_id' => $assetId];
            if ($entry['autotile'] !== null) {
                $item['autotile'] = $entry['autotile'];
            }
            $out[] = $item;
        }

        return $out;
    }

    /**
     * Revision remembered for an already processed restore, null when $clientOpId is new.
     *
     * @throws ValidationException client_op_id already used by another user / map / request kind
     */
    private function replay(User $user, int $mapId, int $versionId, string $clientOpId): ?int
    {
        $row = $this->maps->processed($clientOpId);
        if ($row === null) {
            return null;
        }
        $r = $row['response'];
        if ($row['user_id'] !== $user->id || !is_array($r) || ($r['kind'] ?? null) !== self::REPLAY_KIND
            || ($r['map_id'] ?? null) !== $mapId || ($r['version_id'] ?? null) !== $versionId || !is_int($r['revision'] ?? null)) {
            throw new ValidationException('', ['client_op_id' => 'already_used']);
        }

        return $r['revision'];
    }

    private static function label(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }
        $label = Fields::text($value, PHP_INT_MAX);
        if ($label === null) {
            throw new ValidationException('', ['label' => 'invalid']);
        }
        $label = trim($label);
        if (mb_strlen($label, 'UTF-8') > self::LABEL_MAX) {
            throw new ValidationException('', ['label' => 'too_long']);
        }

        return $label === '' ? null : $label;
    }

    /**
     * API representation "MapVersion" (contract P4c).
     *
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    public static function present(array $row): array
    {
        return [
            'id' => (int) $row['id'],
            'map_id' => (int) $row['map_id'],
            'revision' => (int) $row['revision'],
            'kind' => (string) $row['kind'],
            'label' => $row['label'] === null ? null : (string) $row['label'],
            'size_bytes' => (int) $row['size_bytes'],
            'created_by' => $row['created_by'] === null ? null : [
                'id' => (int) $row['created_by'],
                'username' => (string) ($row['username'] ?? ''),
            ],
            'created_at' => Dates::iso($row['created_at']),
        ];
    }
}
