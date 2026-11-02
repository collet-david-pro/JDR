<?php

declare(strict_types=1);

namespace JDR\Tests\Update;

use JDR\Domain\Update\ReleaseDownloader;

final class FakeReleaseDownloader implements ReleaseDownloader
{
    /** @var list<string> */
    public array $urls = [];

    public function __construct(private ?string $source)
    {
    }

    public function download(string $url, string $path, int $maxBytes): bool
    {
        $this->urls[] = $url;

        return $this->source !== null && copy($this->source, $path);
    }
}
