<?php

declare(strict_types=1);

namespace JDR\Domain\Backup;

defined('JDR_BOOT') || exit;

use JDR\Domain\Assets\AssetStorage;
use JDR\Domain\Jobs\Job;
use JDR\Domain\Jobs\JobHandler;
use JDR\Domain\Update\UpdateStorage;
use JDR\Zip\ZipException;
use JDR\Zip\ZipWriter;

/**
 * assets_backup: ZIP of storage/assets (AssetsArchive), written by slices (resumable ZipWriter). The file list
 * and the manifest lines are kept in files/<work>/ (list.txt, manifest.jsonl), not in the job row.
 * state = {work, started, count?, index, offset, writer, missing} then {work, file};
 * result = {file_name, size_bytes, count, missing}.
 */
final class AssetsBackupJob implements JobHandler
{
    private const ZIP = 'archive.zip';

    public function __construct(private AssetStorage $assets, private BackupStorage $storage)
    {
    }

    public function step(Job $job, float $deadline): void
    {
        $state = $job->state;
        $work = $state['work'] ?? null;
        $started = (int) ($state['started'] ?? time());
        $first = !isset($state['count']);
        $dir = $this->storage->workDir($work, $first);
        $root = $this->storage->storageDir();
        if ($first) {
            $count = $this->listFiles($dir . '/list.txt');
            $state = ['work' => $work, 'started' => $started, 'count' => $count, 'index' => 0, 'offset' => 0, 'writer' => null, 'missing' => 0];
            file_put_contents($dir . '/manifest.jsonl', '');
        }
        $count = (int) $state['count'];
        $index = (int) $state['index'];
        $missing = (int) $state['missing'];
        try {
            $writer = is_array($state['writer']) ? ZipWriter::resume($dir . '/' . self::ZIP, $state['writer']) : ZipWriter::create($dir . '/' . self::ZIP);
        } catch (ZipException) {
            throw new \JDR\Core\Errors\HttpException(410, 'job_expired');
        }
        $list = fopen($dir . '/list.txt', 'rb');
        $manifest = fopen($dir . '/manifest.jsonl', 'ab');
        if ($list === false || $manifest === false) {
            throw new \RuntimeException('Cannot open the work files of the assets backup.');
        }
        try {
            fseek($list, (int) $state['offset']);
            $start = $index;
            while ($index < $count && ($index === $start || microtime(true) < $deadline)) {
                $rel = rtrim((string) fgets($list), "\n");
                $index++;
                $abs = $root . '/' . $rel;
                if ($rel === '' || is_link($abs) || !is_file($abs)) {
                    $missing++;
                    continue;
                }
                $writer->addFile($rel, $abs);
                fwrite($manifest, json_encode([
                    'uuid' => AssetsArchive::uuidOf($rel),
                    'path' => $rel,
                    'size' => (int) filesize($abs),
                    'sha256' => (string) hash_file('sha256', $abs),
                ], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n");
            }
            $offset = (int) ftell($list);
            if ($index >= $count) {
                fclose($manifest);
                $manifest = null;
                $files = [];
                foreach (file($dir . '/manifest.jsonl', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
                    $files[] = json_decode($line, true, 4, JSON_THROW_ON_ERROR);
                }
                $writer->addString(AssetsArchive::MANIFEST, json_encode([
                    'format' => AssetsArchive::FORMAT,
                    'version' => AssetsArchive::VERSION,
                    'app_version' => \APP_VERSION,
                    'created_at' => gmdate('Y-m-d\TH:i:s\Z', $started),
                    'files' => $files,
                ], JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));
                $writer->finish();
                $job->status = Job::DONE;
                $job->state = ['work' => $work, 'file' => self::ZIP];
                $job->result = [
                    'file_name' => 'jdr-assets-' . gmdate('Ymd-His', $started) . '.zip',
                    'size_bytes' => (int) filesize($dir . '/' . self::ZIP),
                    'count' => count($files),
                    'missing' => $missing,
                ];
                @unlink($dir . '/list.txt');
                @unlink($dir . '/manifest.jsonl');
            } else {
                $job->state = ['work' => $work, 'started' => $started, 'count' => $count, 'index' => $index, 'offset' => $offset,
                    'writer' => $writer->state(), 'missing' => $missing];
            }
        } catch (ZipException) {
            throw new BackupException('backup.archive_limit');
        } finally {
            fclose($list);
            if ($manifest !== null) {
                fclose($manifest);
            }
            $writer->close();
        }
        @touch($dir);
        $job->total = $count + 1;
        $job->done = $index + ($job->status === Job::DONE ? 1 : 0);
    }

    public function cleanup(Job $job): void
    {
        $work = $job->state['work'] ?? null;
        if (UpdateStorage::isId($work)) {
            UpdateStorage::removeTree($this->storage->workDir($work));
        }
    }

    /**
     * Writes the sorted list of the files below storage/assets (relative to storage/), links and dot files left out.
     */
    private function listFiles(string $target): int
    {
        $base = $this->assets->assetsDir();
        $root = $this->storage->storageDir();
        $paths = [];
        if (is_dir($base) && !is_link($base)) {
            $items = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($base, \FilesystemIterator::SKIP_DOTS));
            foreach ($items as $item) {
                /** @var \SplFileInfo $item */
                if ($item->isLink() || !$item->isFile() || str_starts_with($item->getFilename(), '.')) {
                    continue;
                }
                $paths[] = substr($item->getPathname(), strlen($root) + 1);
            }
        }
        sort($paths, SORT_STRING);
        if (file_put_contents($target, $paths === [] ? '' : implode("\n", $paths) . "\n") === false) {
            throw new \RuntimeException('Cannot write the list of the assets.');
        }

        return count($paths);
    }
}
