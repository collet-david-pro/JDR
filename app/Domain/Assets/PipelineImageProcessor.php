<?php

declare(strict_types=1);

namespace JDR\Domain\Assets;

defined('JDR_BOOT') || exit;

use JDR\Imaging\ImagePipeline;
use JDR\Imaging\Limits;
use JDR\Imaging\ProcessedImage;

/**
 * Adapter to the image library of lot A (JDR\Imaging\ImagePipeline).
 */
final class PipelineImageProcessor implements ImageProcessor
{
    private ?object $pipeline = null;

    /**
     * @param \Closure(): object $factory builds the ImagePipeline (lazy)
     */
    public function __construct(private \Closure $factory)
    {
    }

    public function process(string $path, Limits $limits, string $workDir): ProcessedImage
    {
        if (!class_exists(ImagePipeline::class)) {
            throw new \RuntimeException('Image pipeline is not installed.');
        }
        $this->pipeline ??= ($this->factory)();
        /** @var ImagePipeline $pipeline */
        $pipeline = $this->pipeline;

        return $pipeline->process($path, $limits, $workDir);
    }
}
