<?php

declare(strict_types=1);

namespace JDR\Domain\Assets\Packs;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Core\Errors\HttpException;
use JDR\Domain\Assets\AssetRepository;
use JDR\Domain\Assets\AssetStorage;
use JDR\Domain\Assets\FileServer;
use JDR\Domain\Jobs\Job;
use JDR\Domain\Jobs\JobHandler;
use JDR\Zip\ZipWriter;

/**
 * pack_export: writes the ZIP in slices (resumable ZipWriter), pack.json last.
 * Assets deleted or no longer visible meanwhile are skipped (result.missing).
 * result = {file_name, size_bytes, count, missing}.
 */
final class PackExportJob implements JobHandler
{
    public function __construct(
        private Db $db,
        private AssetStorage $storage,
        private AssetRepository $assets,
    ) {
    }

    public function step(Job $job, float $deadline): void
    {
        $state = $job->state;
        $zip = $state['zip'] ?? null;
        if (!PackService::isJobFileName($zip)) {
            throw new \RuntimeException('Invalid export job state.');
        }
        $path = $this->storage->jobsDir() . '/' . $zip;
        $ids = is_array($state['ids'] ?? null) ? array_values($state['ids']) : [];
        $index = (int) ($state['index'] ?? 0);
        $manifest = is_array($state['manifest'] ?? null) ? $state['manifest'] : [];
        $missing = is_array($state['missing'] ?? null) ? $state['missing'] : [];
        if (is_array($state['writer'] ?? null)) {
            if (!is_file($path)) {
                throw new HttpException(410, 'job_expired');
            }
            $writer = ZipWriter::resume($path, $state['writer']);
        } else {
            $writer = ZipWriter::create($path);
        }
        try {
            $start = $index;
            // At least one asset per slice: a job always progresses.
            while ($index < count($ids) && ($index === $start || microtime(true) < $deadline)) {
                $id = (int) $ids[$index];
                $index++;
                $asset = $this->assets->find($id);
                $file = $asset === null ? null : $this->storage->path($asset->uuid, $asset->ext);
                if ($asset === null || $asset->deletedAt !== null || ($asset->ownerId !== null && $asset->ownerId !== $job->createdBy)
                    || $file === null || !is_file($file)) {
                    $missing[] = $id;
                    continue;
                }
                $name = sprintf('assets/%04d-%s.%s', $index, FileServer::fileName($asset->name), $asset->ext);
                $writer->addFile($name, $file, time());
                $manifest[] = [
                    'file' => $name,
                    'name' => $asset->name,
                    'kind' => $asset->kind,
                    'category' => $this->categoryName($asset->categoryId),
                    'tags' => array_map(static fn (array $t): string => $t['name'], $this->assets->tagsFor([$asset->id])[$asset->id] ?? []),
                    'sha256' => $asset->sha256,
                ];
            }
            if ($index >= count($ids)) {
                $writer->addString(PackService::MANIFEST, (string) json_encode([
                    'format' => PackService::FORMAT,
                    'version' => PackService::VERSION,
                    'assets' => $manifest,
                ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));
                $writer->finish();
                $job->status = Job::DONE;
                $job->state = ['zip' => $zip];
                $job->result = [
                    'file_name' => 'jdr-assets-' . gmdate('Ymd') . '.zip',
                    'size_bytes' => (int) filesize($path),
                    'count' => count($manifest),
                    'missing' => array_map('strval', $missing),
                ];
            } else {
                $job->state = ['zip' => $zip, 'ids' => $ids, 'index' => $index, 'writer' => $writer->state(), 'manifest' => $manifest, 'missing' => $missing];
            }
        } finally {
            $writer->close();
        }
        $job->done = $index;
    }

    public function cleanup(Job $job): void
    {
        $zip = $job->state['zip'] ?? null;
        if (PackService::isJobFileName($zip)) {
            @unlink($this->storage->jobsDir() . '/' . $zip);
        }
    }

    private function categoryName(?int $id): ?string
    {
        if ($id === null) {
            return null;
        }
        $name = $this->db->fetchValue('SELECT `name` FROM ' . $this->db->t('asset_categories') . ' WHERE `id` = ?', [$id]);

        return is_string($name) ? $name : null;
    }
}
