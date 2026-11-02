<?php

declare(strict_types=1);

namespace JDR\Domain\Update;

defined('JDR_BOOT') || exit;

/**
 * Saves a release archive to a file. Implemented natively; replaced by a fake in the tests.
 */
interface ReleaseDownloader
{
    /**
     * @return bool true when the whole file was saved (HTTP 200, at most $maxBytes)
     */
    public function download(string $url, string $path, int $maxBytes): bool;
}
