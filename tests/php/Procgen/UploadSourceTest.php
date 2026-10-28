<?php

declare(strict_types=1);

namespace JDR\Tests\Procgen;

use JDR\Tests\Assets\AssetsTestCase;

/**
 * POST /assets: optional `source` field (upload | generated); system and pack stay server-only.
 */
final class UploadSourceTest extends AssetsTestCase
{
    public function testGeneratedSourceIsKept(): void
    {
        $alice = $this->userClient('Alice');
        self::assertSame('upload', $this->uploadOk($alice, 'valid_png_opaque.png')['source']);
        $asset = $this->uploadOk($alice, 'valid_png_transparent.png', ['source' => 'generated']);
        self::assertSame('generated', $asset['source']);
        self::assertSame('upload', $this->uploadOk($alice, 'valid_webp_lossy.webp', ['source' => 'upload'])['source']);
    }

    public function testReservedOrUnknownSourcesAreRefused(): void
    {
        $alice = $this->userClient('Alice');
        foreach (['system', 'pack', 'bogus'] as $source) {
            $response = $alice->upload('/assets', self::fixture('valid_png_opaque.png'), ['kind' => 'tile', 'source' => $source]);
            self::assertSame(422, $response->status(), $source . ': ' . $response->body());
            self::assertSame('invalid', $response->payload()['error']['fields']['source'] ?? null, $response->body());
        }
        self::assertSame(0, $this->rows('assets'));
    }
}
