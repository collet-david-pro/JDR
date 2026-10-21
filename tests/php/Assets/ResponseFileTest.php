<?php

declare(strict_types=1);

namespace JDR\Tests\Assets;

use JDR\Core\Response;
use PHPUnit\Framework\TestCase;

require_once dirname(__DIR__) . '/Support/boot.php';

/**
 * File body mode of Response (streamed in chunks by send()).
 */
final class ResponseFileTest extends TestCase
{
    public function testFileBodyIsStreamedInChunks(): void
    {
        $path = tempnam(sys_get_temp_dir(), 'jdr');
        $data = random_bytes(Response::FILE_CHUNK_BYTES * 2 + 123);
        file_put_contents($path, $data);
        try {
            $response = (new Response('ignored'))->withFile($path, 10, Response::FILE_CHUNK_BYTES + 5);
            self::assertSame('', $response->body());
            self::assertSame(['path' => $path, 'offset' => 10, 'length' => Response::FILE_CHUNK_BYTES + 5], $response->file());
            self::assertSame(substr($data, 10, Response::FILE_CHUNK_BYTES + 5), $response->contents());

            ob_start();
            $response->send();
            self::assertSame(substr($data, 10, Response::FILE_CHUNK_BYTES + 5), ob_get_clean());

            ob_start();
            $response->send(false);
            self::assertSame('', ob_get_clean());

            $whole = (new Response())->withFile($path);
            self::assertSame($data, $whole->contents());
            $clamped = (new Response())->withFile($path, strlen($data) + 50);
            self::assertSame('', $clamped->contents());
            self::assertSame('plain', (new Response('plain'))->contents());
        } finally {
            unlink($path);
        }
    }
}
