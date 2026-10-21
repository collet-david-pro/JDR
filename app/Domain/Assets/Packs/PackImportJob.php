<?php

declare(strict_types=1);

namespace JDR\Domain\Assets\Packs;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\HttpException;
use JDR\Domain\Assets\AssetImporter;
use JDR\Domain\Assets\AssetLimits;
use JDR\Domain\Assets\AssetRepository;
use JDR\Domain\Assets\AssetStorage;
use JDR\Domain\Assets\CategoryService;
use JDR\Domain\Assets\ImportRequest;
use JDR\Domain\Jobs\Job;
use JDR\Domain\Jobs\JobHandler;
use JDR\Zip\ZipException;
use JDR\Zip\ZipReader;

/**
 * pack_import: every image goes through the full pipeline (AssetImporter: type, re-encoding,
 * quota, duplicates). Duplicates are skipped; one failure never stops the pack:
 * result = {imported, duplicates, failed, errors: [{file, code}], asset_ids}.
 */
final class PackImportJob implements JobHandler
{
    public const MAX_ERRORS = 500;

    public function __construct(
        private PackService $packs,
        private AssetImporter $importer,
        private AssetStorage $storage,
        private AssetRepository $assets,
        private CategoryService $categories,
        private AssetLimits $limits,
    ) {
    }

    public function step(Job $job, float $deadline): void
    {
        $state = $job->state;
        $zip = $state['zip'] ?? null;
        $items = is_array($state['items'] ?? null) ? $state['items'] : [];
        $owner = is_int($state['owner'] ?? null) ? $state['owner'] : null;
        $index = (int) ($state['index'] ?? 0);
        $result = $job->result ?? ['imported' => 0, 'duplicates' => 0, 'failed' => 0, 'errors' => [], 'asset_ids' => []];
        if (!PackService::isJobFileName($zip) || !is_file($this->storage->jobsDir() . '/' . $zip)) {
            throw new HttpException(410, 'job_expired');
        }
        $reader = new ZipReader($this->storage->jobsDir() . '/' . $zip, $this->packs->zipLimits());
        try {
            $start = $index;
            // At least one item per slice: a job always progresses.
            while ($index < count($items) && ($index === $start || microtime(true) < $deadline)) {
                $item = $items[$index];
                $this->importOne($reader, is_array($item) ? $item : [], $owner, $result);
                $index++;
            }
        } finally {
            $reader->close();
        }
        $job->done = $index;
        $job->state['index'] = $index;
        $job->result = $result;
        if ($index >= count($items)) {
            $job->status = Job::DONE;
            $this->cleanup($job);
        }
    }

    public function cleanup(Job $job): void
    {
        $zip = $job->state['zip'] ?? null;
        if (PackService::isJobFileName($zip)) {
            @unlink($this->storage->jobsDir() . '/' . $zip);
        }
    }

    /**
     * @param array<string, mixed> $item
     * @param array<string, mixed> $result
     */
    private function importOne(ZipReader $reader, array $item, ?int $owner, array &$result): void
    {
        $file = is_string($item['file'] ?? null) ? $item['file'] : '';
        $tmp = $this->storage->newTmpPath();
        try {
            $entry = $reader->find($file);
            if ($entry === null) {
                throw new ZipException('missing_entry');
            }
            $reader->extractTo($entry, $tmp, $this->limits->maxUploadBytes());
            // Same bytes as an asset this owner already has (re-import of an export): skip early.
            $existing = $this->assets->findDuplicate($owner, (string) hash_file('sha256', $tmp));
            if ($existing !== null) {
                $result['duplicates']++;

                return;
            }
            $category = is_string($item['category'] ?? null) ? $this->categories->findOrCreate($owner, $item['category']) : null;
            $tags = is_array($item['tags'] ?? null) ? array_values(array_filter($item['tags'], 'is_string')) : [];
            $imported = $this->importer->import($tmp, new ImportRequest(
                $owner,
                is_string($item['name'] ?? null) && $item['name'] !== '' ? $item['name'] : ImportRequest::nameFromFile($file),
                is_string($item['kind'] ?? null) ? $item['kind'] : 'object',
                $category,
                $tags,
                'pack',
            ));
            if ($imported->duplicate) {
                $result['duplicates']++;
            } else {
                $result['imported']++;
                $result['asset_ids'][] = $imported->asset->id;
            }
        } catch (HttpException $e) {
            $this->fail($result, $file, $e->errorCode());
        } catch (ZipException $e) {
            $this->fail($result, $file, 'invalid_pack');
        } finally {
            $this->storage->remove($tmp);
        }
    }

    /**
     * @param array<string, mixed> $result
     */
    private function fail(array &$result, string $file, string $code): void
    {
        $result['failed']++;
        if (count($result['errors']) < self::MAX_ERRORS) {
            $result['errors'][] = ['file' => $file, 'code' => $code];
        }
    }
}
