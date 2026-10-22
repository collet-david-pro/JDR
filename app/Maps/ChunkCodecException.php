<?php

declare(strict_types=1);

namespace JDR\Maps;

defined('JDR_BOOT') || exit;

/**
 * Invalid tile chunk (projet.md 12.2). $reason: bad_size | bad_magic | bad_version | bad_layer |
 * bad_palette_index | bad_compression (same codes as the front codec).
 */
final class ChunkCodecException extends \RuntimeException
{
    public function __construct(public readonly string $reason, string $message)
    {
        parent::__construct($message);
    }
}
