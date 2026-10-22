<?php

declare(strict_types=1);

namespace JDR\Domain\Maps\Transfer;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Core\Errors\HttpException;
use JDR\Core\Errors\NotFoundException;
use JDR\Core\Errors\PayloadTooLargeException;
use JDR\Core\Errors\ValidationException;
use JDR\Core\Logger;
use JDR\Domain\Assets\Asset;
use JDR\Domain\Assets\AssetImporter;
use JDR\Domain\Assets\AssetLimits;
use JDR\Domain\Assets\AssetStorage;
use JDR\Domain\Assets\ImportRequest;
use JDR\Domain\Games\Game;
use JDR\Domain\Maps\Map;
use JDR\Domain\Maps\MapOpsInput;
use JDR\Domain\Maps\MapRepository;
use JDR\Domain\Users\User;
use JDR\Maps\Document\MapDocumentValidator;
use JDR\Maps\Document\MapDocumentWriter;
use JDR\Maps\Document\PaletteResolver;
use JDR\Zip\ZipEntry;
use JDR\Zip\ZipException;
use JDR\Zip\ZipLimits;
use JDR\Zip\ZipReader;

/**
 * POST /games/{id}/maps/import (contract P4c): a map document (JSON) or a ZIP
 * {map.json, assets/<sha256>.<ext>} becomes a new map of the game.
 *
 * 1. the file is sniffed (ZIP signature, else JSON), read within bounds (ZIP protections of
 *    ZipReader: entries, sizes, ratio, paths), decoded, migrated and strictly validated
 *    (MapDocumentValidator): nothing is written before the whole document is valid;
 * 2. one transaction: palette references resolved among the importer's assets, then the general
 *    library, then the files of the ZIP, each through the FULL import pipeline (AssetImporter:
 *    type, re-encoding, quota, duplicates); the map, its floors, chunks and asset references are
 *    written; client_op_id remembered. Any failure rolls everything back (files placed by the
 *    asset imports are deleted). A quota overflow fails the import (413 quota_exceeded);
 * 3. unresolved references (absent, or refused by the image pipeline) are reported in
 *    missing_assets [{ref, name}]: their palette index is kept, empty.
 */
final class MapImportService
{
    private const REPLAY_KIND = 'map_import';
    private const ASSET_ENTRY = '#^assets/([0-9a-f]{64})\.(png|jpe?g|webp|gif)$#D';

    public function __construct(
        private Db $db,
        private MapRepository $maps,
        private MapDocumentWriter $writer,
        private PaletteResolver $resolver,
        private AssetImporter $importer,
        private AssetStorage $storage,
        private AssetLimits $limits,
        private Logger $logger,
    ) {
    }

    /**
     * Largest accepted file (JSON or ZIP).
     */
    public function maxBytes(): int
    {
        return max(1, min(AssetLimits::MAX_PACK_BYTES, $this->limits->phpUploadBytes()));
    }

    /**
     * Result of an already processed import with this client_op_id, null when new.
     *
     * @return array{map: Map, missing_assets: list<array{ref: string, name: string}>}|null
     * @throws ValidationException already_used | NotFoundException imported map gone
     */
    public function replay(User $user, Game $game, string $clientOpId): ?array
    {
        $row = $this->maps->processed($clientOpId);
        if ($row === null) {
            return null;
        }
        $r = $row['response'];
        if ($row['user_id'] !== $user->id || !is_array($r) || ($r['kind'] ?? null) !== self::REPLAY_KIND
            || ($r['game_id'] ?? null) !== $game->id || !is_int($r['map_id'] ?? null) || !is_array($r['missing_assets'] ?? null)) {
            throw new ValidationException('', ['client_op_id' => 'already_used']);
        }
        $map = $this->maps->find($r['map_id']);
        if ($map === null || $map->deletedAt !== null) {
            throw new NotFoundException();
        }

        return ['map' => $map, 'missing_assets' => array_values($r['missing_assets'])];
    }

    /**
     * Imports the file at $path (in storage/tmp; deleted by the caller).
     *
     * @return array{map: Map, missing_assets: list<array{ref: string, name: string}>}
     */
    public function import(User $user, Game $game, string $path, ?string $clientOpId): array
    {
        if ($clientOpId !== null && preg_match(MapOpsInput::CLIENT_OP_ID_PATTERN, $clientOpId) !== 1) {
            throw new ValidationException('', ['client_op_id' => 'invalid']);
        }
        $size = (int) @filesize($path);
        $head = (string) @file_get_contents($path, false, null, 0, 4);
        if ($size === 0) {
            throw new ValidationException('', ['file' => 'invalid'], 'invalid_map_file');
        }
        $reader = null;
        try {
            if ($head === "PK\x03\x04" || $head === "PK\x05\x06") {
                $reader = $this->openZip($path);
                $entry = $reader->find('map.json');
                if ($entry === null || $entry->isDir) {
                    throw new ValidationException('', ['file' => 'missing_document'], 'invalid_map_file');
                }
                $json = $this->readEntry($reader, $entry);
            } else {
                if ($size > MapDocumentValidator::MAX_BYTES) {
                    throw new PayloadTooLargeException('', [], 'file_too_large');
                }
                $json = (string) file_get_contents($path);
            }
            $doc = (new MapDocumentValidator())->validate(MapDocumentValidator::decode($json));
            unset($json);
            $files = $reader === null ? [] : self::assetEntries($reader);

            return $this->write($user, $game, $doc, $reader, $files, $clientOpId);
        } finally {
            $reader?->close();
        }
    }

    /**
     * @param array<string, mixed>   $doc   normalized document
     * @param array<string, ZipEntry> $files sha256 => ZIP entry
     * @return array{map: Map, missing_assets: list<array{ref: string, name: string}>}
     */
    private function write(User $user, Game $game, array $doc, ?ZipReader $reader, array $files, ?string $clientOpId): array
    {
        $result = $this->db->transaction(function () use ($user, $game, $doc, $reader, $files, $clientOpId): array {
            /** @var list<Asset> $created */
            $created = [];
            try {
                $names = [];
                foreach ($doc['palette'] as $entry) {
                    if ($entry !== null) {
                        $names[$entry['sha256']] ??= $entry['name'];
                    }
                }
                $bySha = $this->resolver->resolve($user->id, array_keys($names));
                foreach ($names as $sha => $name) {
                    if (isset($bySha[$sha]) || !isset($files[$sha]) || $reader === null) {
                        continue;
                    }
                    $asset = $this->importAsset($user, $reader, $files[$sha], $name, $created);
                    if ($asset !== null) {
                        $bySha[$sha] = $asset->id;
                    }
                }
                $palette = [];
                $missing = [];
                foreach ($doc['palette'] as $entry) {
                    $assetId = $entry === null ? null : ($bySha[$entry['sha256']] ?? null);
                    if ($entry === null || $assetId === null) {
                        if ($entry !== null) {
                            $missing['sha256:' . $entry['sha256']] ??= ['ref' => 'sha256:' . $entry['sha256'], 'name' => $entry['name']];
                        }
                        $palette[] = null;
                        continue;
                    }
                    $item = ['asset_id' => $assetId];
                    if ($entry['autotile'] !== null) {
                        $item['autotile'] = $entry['autotile'];
                    }
                    $palette[] = $item;
                }
                $missing = array_values($missing);
                $mapId = $this->writer->create($game->id, $user->id, null, $doc, $palette);
                if ($clientOpId !== null) {
                    $this->remember($user, $clientOpId, [
                        'kind' => self::REPLAY_KIND,
                        'game_id' => $game->id,
                        'map_id' => $mapId,
                        'missing_assets' => $missing,
                    ]);
                }

                return ['map_id' => $mapId, 'missing_assets' => $missing];
            } catch (\Throwable $e) {
                foreach ($created as $asset) {
                    $this->storage->deleteFiles($asset->uuid, $asset->ext);
                }
                throw $e;
            }
        });

        return [
            'map' => $this->maps->find($result['map_id']) ?? throw new \RuntimeException('Map lost after import.'),
            'missing_assets' => $result['missing_assets'],
        ];
    }

    /**
     * One file of the ZIP through the full asset pipeline; null when the image is refused.
     *
     * @param list<Asset> $created assets created by this import (cleanup on failure)
     * @throws PayloadTooLargeException quota_exceeded
     */
    private function importAsset(User $user, ZipReader $reader, ZipEntry $entry, string $name, array &$created): ?Asset
    {
        $tmp = $this->storage->newTmpPath();
        try {
            $reader->extractTo($entry, $tmp, $this->limits->maxUploadBytes());
        } catch (ZipException $e) {
            $this->storage->remove($tmp);
            $this->logger->info('Map import: unreadable asset entry', ['reason' => $e->reason()]);
            throw new ValidationException('', ['file' => 'invalid'], 'invalid_map_file');
        }
        try {
            $result = $this->importer->import($tmp, new ImportRequest(
                $user->id,
                $name !== '' ? $name : 'image',
                'tile',
            ));
        } catch (HttpException $e) {
            if ($e->errorCode() === 'quota_exceeded') {
                throw $e;
            }
            $this->logger->info('Map import: asset refused', ['code' => $e->errorCode()]);

            return null;
        } finally {
            $this->storage->remove($tmp);
        }
        if (!$result->duplicate) {
            $created[] = $result->asset;
        }

        return $result->asset;
    }

    /**
     * @param array<string, mixed> $response
     */
    private function remember(User $user, string $clientOpId, array $response): void
    {
        try {
            $this->maps->rememberProcessed($clientOpId, $user->id, $response);
        } catch (\PDOException $e) {
            if ((string) $e->getCode() !== '23000') {
                throw $e;
            }
            throw new ValidationException('', ['client_op_id' => 'already_used']);
        }
    }

    /**
     * @throws ValidationException invalid_map_file
     */
    private function openZip(string $path): ZipReader
    {
        $limits = new ZipLimits(
            MapOpsInput::MAX_PALETTE + 64,
            AssetLimits::MAX_PACK_BYTES,
            max(MapDocumentValidator::MAX_BYTES, $this->limits->maxUploadBytes()),
            // map.json of a patterned map repeats identical chunks: sizes are bounded anyway.
            1000,
            65536,
        );
        try {
            return new ZipReader($path, $limits);
        } catch (ZipException $e) {
            $this->logger->info('Map import: archive refused', ['reason' => $e->reason()]);
            throw new ValidationException('', ['file' => 'invalid'], 'invalid_map_file');
        }
    }

    /**
     * @throws ValidationException invalid_map_file
     */
    private function readEntry(ZipReader $reader, ZipEntry $entry): string
    {
        if ($entry->size > MapDocumentValidator::MAX_BYTES) {
            throw new ValidationException('', ['file' => 'too_large'], 'invalid_map_file');
        }
        try {
            return $reader->read($entry, MapDocumentValidator::MAX_BYTES);
        } catch (ZipException $e) {
            $this->logger->info('Map import: map.json unreadable', ['reason' => $e->reason()]);
            throw new ValidationException('', ['file' => 'invalid'], 'invalid_map_file');
        }
    }

    /**
     * Asset files of the archive: sha256 => entry (assets/<sha256>.<ext>; anything else ignored).
     *
     * @return array<string, ZipEntry>
     */
    private static function assetEntries(ZipReader $reader): array
    {
        $out = [];
        foreach ($reader->files() as $entry) {
            if (preg_match(self::ASSET_ENTRY, $entry->name, $m) === 1) {
                $out[$m[1]] ??= $entry;
            }
        }

        return $out;
    }
}
