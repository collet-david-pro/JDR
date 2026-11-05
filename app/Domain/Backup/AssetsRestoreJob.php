<?php

declare(strict_types=1);

namespace JDR\Domain\Backup;

defined('JDR_BOOT') || exit;

use JDR\Domain\Assets\AssetStorage;
use JDR\Domain\Jobs\Job;
use JDR\Domain\Jobs\JobHandler;
use JDR\Domain\Update\UpdateStorage;
use JDR\Zip\ZipException;

/**
 * assets_restore: puts the files of an assets backup back into storage/assets. Only paths that follow the
 * layout of AssetStorage are written (anything else is "rejected"), each file must match its size and SHA-256
 * in manifest-assets.json, identical files already present are "skipped", nothing is ever deleted.
 * state = {work, index, restored, skipped, rejected, rejected_files}; the archive is files/<work>/restore.zip.
 * result = {restored, skipped, rejected, rejected_files (first 50)}.
 */
final class AssetsRestoreJob implements JobHandler
{
    public const ZIP = 'restore.zip';
    private const MAX_LISTED = 50;

    public function __construct(private AssetStorage $assets, private BackupStorage $storage)
    {
    }

    /**
     * Restores asset files from the uploaded archive until the deadline, keeping its position in the job.
     */
    public function step(Job $job, float $deadline): void
    {
        $state = $job->state;
        $work = $state['work'] ?? null;
        $dir = $this->storage->workDir($work);
        if (!is_file($dir . '/' . self::ZIP)) {
            throw new \JDR\Core\Errors\HttpException(410, 'job_expired');
        }
        [$zip, $manifest] = AssetsArchive::open($dir . '/' . self::ZIP);
        $root = $this->storage->storageDir();
        $counts = [
            'restored' => (int) ($state['restored'] ?? 0),
            'skipped' => (int) ($state['skipped'] ?? 0),
            'rejected' => (int) ($state['rejected'] ?? 0),
        ];
        $rejectedFiles = is_array($state['rejected_files'] ?? null) ? $state['rejected_files'] : [];
        $files = array_values(array_filter($zip->files(), static fn ($e): bool => $e->name !== AssetsArchive::MANIFEST));
        $index = (int) ($state['index'] ?? 0);
        try {
            $start = $index;
            while ($index < count($files) && ($index === $start || microtime(true) < $deadline)) {
                $entry = $files[$index];
                $index++;
                $expected = $manifest[$entry->name] ?? null;
                $target = $root . '/' . $entry->name;
                if ($expected === null || !AssetsArchive::isAssetPath($entry->name) || $entry->size !== $expected['size']
                    || $this->linkOnPath($root, $entry->name)) {
                    $counts['rejected']++;
                    if (count($rejectedFiles) < self::MAX_LISTED) {
                        $rejectedFiles[] = $entry->name;
                    }
                    continue;
                }
                if (is_file($target) && filesize($target) === $expected['size'] && hash_file('sha256', $target) === $expected['sha256']) {
                    $counts['skipped']++;
                    continue;
                }
                $tmp = $this->assets->newTmpPath('.restore');
                try {
                    $zip->extractTo($entry, $tmp, $expected['size']);
                    if (hash_file('sha256', $tmp) !== $expected['sha256']) {
                        $counts['rejected']++;
                        if (count($rejectedFiles) < self::MAX_LISTED) {
                            $rejectedFiles[] = $entry->name;
                        }
                        continue;
                    }
                    $this->assets->place($tmp, $target);
                    $counts['restored']++;
                } catch (ZipException $e) {
                    throw BackupException::invalid('zip_' . $e->reason());
                } finally {
                    @unlink($tmp);
                }
            }
        } finally {
            $zip->close();
        }
        $job->total = count($files);
        $job->done = $index;
        $job->state = ['work' => $work, 'index' => $index] + $counts + ['rejected_files' => $rejectedFiles];
        if ($index >= count($files)) {
            $job->status = Job::DONE;
            $job->result = $counts + ['rejected_files' => $rejectedFiles];
            $job->state = ['work' => $work];
            UpdateStorage::removeTree($dir);
        } else {
            @touch($dir);
        }
    }

    /**
     * Deletes the extraction directory after a cancellation or failure.
     */
    public function cleanup(Job $job): void
    {
        $work = $job->state['work'] ?? null;
        if (UpdateStorage::isId($work)) {
            UpdateStorage::removeTree($this->storage->workDir($work));
        }
    }

    /**
     * True when the target or one of its directories below storage/ is a symbolic link.
     */
    private function linkOnPath(string $root, string $name): bool
    {
        $path = $root;
        foreach (explode('/', $name) as $segment) {
            $path .= '/' . $segment;
            if (is_link($path)) {
                return true;
            }
        }

        return false;
    }
}
