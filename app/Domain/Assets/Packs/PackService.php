<?php

declare(strict_types=1);

namespace JDR\Domain\Assets\Packs;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\ValidationException;
use JDR\Core\Logger;
use JDR\Domain\Assets\Asset;
use JDR\Domain\Assets\AssetLimits;
use JDR\Domain\Assets\AssetRepository;
use JDR\Domain\Assets\AssetStorage;
use JDR\Domain\Assets\CategoryService;
use JDR\Domain\Assets\ImportRequest;
use JDR\Domain\Assets\TagService;
use JDR\Domain\Jobs\Job;
use JDR\Domain\Jobs\JobRepository;
use JDR\Domain\Users\User;
use JDR\Zip\ZipException;
use JDR\Zip\ZipLimits;
use JDR\Zip\ZipReader;

/**
 * Asset packs (projet.md 2.6): ZIP = pack.json
 * {format: "jdr-asset-pack", version: 1, assets: [{file, name, kind, category, tags, sha256}]} + images.
 * Import and export run as background jobs (pack_import, pack_export); their files live in storage/jobs.
 */
final class PackService
{
    public const FORMAT = 'jdr-asset-pack';
    public const VERSION = 1;
    public const MANIFEST = 'pack.json';
    public const MAX_MANIFEST_BYTES = 2097152;
    public const MAX_ASSETS = 5000;
    private const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];

    public function __construct(
        private JobRepository $jobs,
        private AssetStorage $storage,
        private AssetLimits $limits,
        private AssetRepository $assets,
        private CategoryService $categories,
        private Logger $logger,
    ) {
    }

    public function zipLimits(): ZipLimits
    {
        return new ZipLimits(
            self::MAX_ASSETS + 1000,
            2147483647,
            max($this->limits->maxUploadBytes(), self::MAX_MANIFEST_BYTES),
            100,
            65536,
        );
    }

    /**
     * Validates the archive (directory, protections, manifest) and creates the import job.
     * The archive must already be in storage/jobs ($zipName = its base name).
     *
     * @throws ValidationException 422 invalid_pack
     */
    public function createImport(User $user, string $zipName, ?int $ownerId): Job
    {
        $path = $this->storage->jobsDir() . '/' . $zipName;
        try {
            $reader = new ZipReader($path, $this->zipLimits());
            try {
                $items = $this->items($reader);
            } finally {
                $reader->close();
            }
        } catch (ZipException $e) {
            @unlink($path);
            $this->logger->info('Asset pack rejected', ['reason' => $e->reason()]);
            throw new ValidationException('', ['file' => 'invalid'], 'invalid_pack');
        }
        if ($items === []) {
            @unlink($path);
            throw new ValidationException('', ['file' => 'empty'], 'invalid_pack');
        }

        return $this->jobs->create('pack_import', $user->id, count($items), [
            'zip' => $zipName,
            'owner' => $ownerId,
            'items' => $items,
            'index' => 0,
        ]);
    }

    /**
     * Export job of the given assets (visible to the user), of a category, or of every own asset.
     *
     * @param list<int>|null $assetIds
     * @throws ValidationException
     */
    public function createExport(User $user, ?array $assetIds, ?int $categoryId): Job
    {
        if ($categoryId !== null) {
            $category = $this->categories->find($categoryId);
            if ($category === null || ($category['owner_user_id'] !== null && (int) $category['owner_user_id'] !== $user->id)) {
                throw new ValidationException('', ['category_id' => 'invalid']);
            }
        }
        $ids = $this->assets->visibleIds($user->id, $assetIds, $categoryId, self::MAX_ASSETS);
        if ($assetIds !== null && count($ids) !== count(array_unique($assetIds))) {
            throw new ValidationException('', ['asset_ids' => 'invalid']);
        }
        if ($ids === []) {
            throw new ValidationException('', ['asset_ids' => 'empty']);
        }

        return $this->jobs->create('pack_export', $user->id, count($ids), [
            'ids' => $ids,
            'index' => 0,
            'zip' => bin2hex(random_bytes(12)) . '.zip',
            'writer' => null,
            'manifest' => [],
            'missing' => [],
        ]);
    }

    public static function isJobFileName(mixed $name): bool
    {
        return is_string($name) && preg_match('/^[0-9a-f]{24}\.zip$/D', $name) === 1;
    }

    /**
     * Assets to import: from pack.json, else every image file of the archive.
     *
     * @return list<array{file: string, name: string, kind: string, category: ?string, tags: list<string>, sha256: ?string}>
     */
    private function items(ZipReader $reader): array
    {
        $manifest = $reader->find(self::MANIFEST);
        if ($manifest === null) {
            $items = [];
            foreach ($reader->files() as $entry) {
                $ext = strtolower(pathinfo($entry->name, PATHINFO_EXTENSION));
                if (in_array($ext, self::IMAGE_EXTENSIONS, true) && !str_starts_with(basename($entry->name), '.')
                    && !str_starts_with($entry->name, '__MACOSX/')) {
                    $items[] = [
                        'file' => $entry->name,
                        'name' => ImportRequest::nameFromFile($entry->name),
                        'kind' => 'object',
                        'category' => null,
                        'tags' => [],
                        'sha256' => null,
                    ];
                }
            }

            return array_slice($items, 0, self::MAX_ASSETS);
        }
        $data = json_decode($reader->read($manifest, self::MAX_MANIFEST_BYTES), true, 16);
        if (!is_array($data) || ($data['format'] ?? null) !== self::FORMAT || ($data['version'] ?? null) !== self::VERSION
            || !is_array($data['assets'] ?? null) || !array_is_list($data['assets']) || count($data['assets']) > self::MAX_ASSETS) {
            throw new ZipException('invalid_manifest', 'Invalid pack.json.');
        }
        $items = [];
        foreach ($data['assets'] as $raw) {
            $file = is_array($raw) ? ($raw['file'] ?? null) : null;
            $entry = is_string($file) ? $reader->find($file) : null;
            if (!is_array($raw) || $entry === null || $entry->isDir || $file === self::MANIFEST) {
                throw new ZipException('invalid_manifest', 'pack.json references a missing file.');
            }
            $name = is_string($raw['name'] ?? null) ? trim((string) preg_replace('/[\x00-\x1F\x7F]/u', '', $raw['name'])) : '';
            $name = preg_match('//u', $name) === 1 ? mb_substr($name, 0, 120, 'UTF-8') : '';
            $category = TagService::normalize($raw['category'] ?? null, 80);
            $tags = [];
            foreach (is_array($raw['tags'] ?? null) ? array_slice($raw['tags'], 0, TagService::MAX_TAGS_PER_ASSET) : [] as $tag) {
                $tag = TagService::normalize($tag);
                if ($tag !== null) {
                    $tags[mb_strtolower($tag, 'UTF-8')] ??= $tag;
                }
            }
            $sha = $raw['sha256'] ?? null;
            $items[] = [
                'file' => $file,
                'name' => $name !== '' ? $name : ImportRequest::nameFromFile($file),
                'kind' => in_array($raw['kind'] ?? null, Asset::KINDS, true) ? (string) $raw['kind'] : 'object',
                'category' => $category,
                'tags' => array_values($tags),
                'sha256' => is_string($sha) && preg_match('/^[0-9a-f]{64}$/D', $sha) === 1 ? $sha : null,
            ];
        }

        return $items;
    }
}
