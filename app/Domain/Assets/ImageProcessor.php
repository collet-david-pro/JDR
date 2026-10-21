<?php

declare(strict_types=1);

namespace JDR\Domain\Assets;

defined('JDR_BOOT') || exit;

use JDR\Imaging\ImageRejected;
use JDR\Imaging\Limits;
use JDR\Imaging\ProcessedImage;

/**
 * Steps 3 to 8 of the import pipeline (projet.md 11.3): real type, dimensions, animation checks,
 * re-encoding, thumbnail, SHA-256. Implemented by PipelineImageProcessor (JDR\Imaging\ImagePipeline);
 * tests inject a fake.
 */
interface ImageProcessor
{
    /**
     * Final file and thumbnail are written in $workDir.
     *
     * @throws ImageRejected
     */
    public function process(string $path, Limits $limits, string $workDir): ProcessedImage;
}
