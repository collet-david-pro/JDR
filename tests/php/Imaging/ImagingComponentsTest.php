<?php

declare(strict_types=1);

namespace JDR\Tests\Imaging;

use JDR\Imaging\DimensionGuard;
use JDR\Imaging\GifParser;
use JDR\Imaging\ImageRejected;
use JDR\Imaging\JpegParser;
use JDR\Imaging\Limits;
use JDR\Imaging\PngParser;
use JDR\Imaging\Reencoder;
use JDR\Imaging\Sniffer;
use JDR\Imaging\TrapScanner;
use JDR\Imaging\WebpParser;

/**
 * Unit tests of the pipeline components (limits, errors, parsers, trap scan, re-encoding).
 */
final class ImagingComponentsTest extends ImagingTestCase
{
    public function testLimitsFromSettings(): void
    {
        $limits = Limits::fromSettings([
            'max_upload_bytes' => 2048,
            'max_dimension_px' => '512',
            'max_total_pixels' => 262144.0,
            'max_frames' => 0,
            'max_animation_ms' => 'abc',
        ]);
        self::assertSame(2048, $limits->maxBytes);
        self::assertSame(512, $limits->maxDimension);
        self::assertSame(262144, $limits->maxTotalPixels);
        self::assertSame(Limits::DEFAULT_MAX_FRAMES, $limits->maxFrames);
        self::assertSame(Limits::DEFAULT_MAX_ANIMATION_MS, $limits->maxAnimationMs);

        $defaults = Limits::fromSettings([]);
        self::assertSame([10485760, 4096, 16777216, 300, 20000], [
            $defaults->maxBytes, $defaults->maxDimension, $defaults->maxTotalPixels,
            $defaults->maxFrames, $defaults->maxAnimationMs,
        ]);
        $this->expectException(\InvalidArgumentException::class);
        new Limits(maxFrames: 0);
    }

    public function testImageRejectedStatusesAndGenericMessage(): void
    {
        $cases = [
            [ImageRejected::unsupportedType('a', 'A'), 415, 'unsupported_type'],
            [ImageRejected::fileTooLarge('b', 'B'), 413, 'file_too_large'],
            [ImageRejected::imageTooLarge('c', 'C'), 422, 'image_too_large'],
            [ImageRejected::animationTooLong('d', 'D'), 422, 'animation_too_long'],
        ];
        foreach ($cases as [$e, $status, $code]) {
            self::assertSame($status, $e->status());
            self::assertSame($code, $e->errorCode());
            self::assertSame('', $e->getMessage());
            self::assertSame([], $e->fields());
        }
        self::assertSame('a', $cases[0][0]->reason());
        self::assertSame('A', $cases[0][0]->detail());
    }

    public function testParseIniBytes(): void
    {
        self::assertNull(DimensionGuard::parseIniBytes('-1'));
        self::assertSame(128 * 1024 * 1024, DimensionGuard::parseIniBytes('128M'));
        self::assertSame(1024 * 1024 * 1024, DimensionGuard::parseIniBytes('1G'));
        self::assertSame(512 * 1024, DimensionGuard::parseIniBytes('512k'));
        self::assertSame(1000000, DimensionGuard::parseIniBytes('1000000'));
    }

    public function testSniffer(): void
    {
        $sniffer = new Sniffer();
        self::assertSame(Sniffer::PNG, $sniffer->sniff(self::fixture('valid_apng.png')));
        self::assertSame(Sniffer::JPEG, $sniffer->sniff(self::fixture('valid_jpeg_exif_orientation6.jpg')));
        self::assertSame(Sniffer::GIF, $sniffer->sniff(self::fixture('valid_gif_animated.gif')));
        self::assertSame(Sniffer::WEBP, $sniffer->sniff(self::fixture('valid_webp_animated.webp')));
        self::assertNull(Sniffer::bySignature('RIFF0000AVI '));
        self::assertNull(Sniffer::bySignature('GIF88a'));
        // Signature of a GIF but nothing else: finfo must agree, or the file is refused.
        $path = $this->work . '/short.gif';
        file_put_contents($path, "\xFF\xD8\xFF");
        self::assertRejected(fn () => $sniffer->sniff($path), 'unsupported_type', 'mime_mismatch');
        unlink($path);
    }

    public function testGifDelaysFollowBrowsers(): void
    {
        self::assertSame(10, GifParser::effectiveDelayCs(0));
        self::assertSame(10, GifParser::effectiveDelayCs(1));
        self::assertSame(2, GifParser::effectiveDelayCs(2));
        self::assertSame(50, GifParser::effectiveDelayCs(50));

        // Two frames without delay: 2 x 100 ms.
        $info = (new GifParser())->parse($this->gif([$this->gce(0), $this->image(), $this->gce(1), $this->image()]));
        self::assertSame(2, $info->frameCount);
        self::assertSame(200, $info->durationMs);
        self::assertTrue($info->animated);
    }

    public function testGifPlainTextExtensionIsDroppedWithItsControlBlock(): void
    {
        $plainText = "\x21\x01\x0C" . str_repeat("\0", 12) . "\x05HELLO\x00";
        $data = $this->gif([$this->gce(500), $plainText, $this->gce(7), $this->image(), $this->gce(3), $this->image()]);
        $info = (new GifParser())->parse($data);
        self::assertStringNotContainsString('HELLO', (string) $info->cleanData);
        self::assertSame(2, substr_count((string) $info->cleanData, "\x21\xF9"));
        self::assertSame(100, $info->durationMs); // 7 cs + 3 cs, the 500 cs belonged to the text.
    }

    public function testGifStructureErrors(): void
    {
        $parser = new GifParser();
        $cases = [
            'no image' => $this->gif([]),
            'bad gce size' => $this->gif(["\x21\xF9\x05\x00\x00\x00\x00\x00\x00", $this->image()]),
            'bad lzw size' => $this->gif(["\x2C" . pack('vvvv', 0, 0, 2, 2) . "\x00\x0C\x02\x01\x00\x00"]),
            'no trailer' => substr($this->gif([$this->image()]), 0, -1),
        ];
        foreach ($cases as $label => $data) {
            try {
                $parser->parse($data);
                self::fail("{$label} must be refused");
            } catch (ImageRejected $e) {
                self::assertSame('unsupported_type', $e->errorCode(), $label);
            }
        }
    }

    public function testWebpParserDetails(): void
    {
        self::assertSame(100, WebpParser::effectiveDurationMs(0));
        self::assertSame(100, WebpParser::effectiveDurationMs(10));
        self::assertSame(11, WebpParser::effectiveDurationMs(11));

        $info = (new WebpParser())->parse((string) file_get_contents(self::fixture('valid_webp_animated.webp')));
        self::assertTrue($info->animated);
        self::assertSame([48, 32], [$info->width, $info->height]);
        self::assertNotNull($info->firstFrame);
        // First frame rebuilt as a still VP8X + ALPH + VP8 WebP that GD decodes.
        $still = $info->firstFrame['data'];
        self::assertSame(strlen($still) - 8, unpack('V', substr($still, 4, 4))[1]);
        self::assertStringContainsString('ALPH', $still);
        $image = @imagecreatefromstring($still);
        self::assertInstanceOf(\GdImage::class, $image);
        self::assertSame([48, 32], [imagesx($image), imagesy($image)]);

        // A frame outside the canvas is refused.
        $data = (string) file_get_contents(self::fixture('valid_webp_animated.webp'));
        $anmf = strpos($data, 'ANMF', strpos($data, 'ANMF') + 4);
        $data[$anmf + 8] = "\x7F"; // second frame X offset -> 254 px
        self::assertRejected(fn () => (new WebpParser())->parse($data), 'unsupported_type', 'webp_invalid');
    }

    public function testPngAndJpegParsers(): void
    {
        $apng = (new PngParser())->parse((string) file_get_contents(self::fixture('valid_apng.png')));
        self::assertTrue($apng->isApng);
        $png = (new PngParser())->parse((string) file_get_contents(self::fixture('valid_png_opaque.png')));
        self::assertFalse($png->isApng);
        self::assertSame([64, 48], [$png->width, $png->height]);

        $jpeg = (new JpegParser())->parse((string) file_get_contents(self::fixture('valid_jpeg_exif_orientation6.jpg')));
        self::assertSame(6, $jpeg->orientation);
        self::assertSame([80, 40], [$jpeg->width, $jpeg->height]);
        self::assertNull(JpegParser::orientation('garbage'));
    }

    public function testTrapScanner(): void
    {
        $scanner = new TrapScanner();
        $data = "HEADER<?=XYZ<sVg..PAYLOAD";
        // Short patterns inside compressed pixel data are ignored...
        $scanner->scan($data, [[6, 13]]);
        // ...but not outside.
        self::assertRejected(fn () => $scanner->scan($data, [[6, 4]]), 'unsupported_type', 'script_payload');
        self::assertRejected(fn () => $scanner->scan($data), 'unsupported_type', 'script_payload');
        // Long patterns are refused anywhere, whatever the case.
        foreach (['<?PHP', '<ScRiPt', '<HTML', '<!DocType'] as $pattern) {
            $raw = 'AAAA' . $pattern . 'BBBB';
            self::assertRejected(fn () => $scanner->scan($raw, [[0, strlen($raw)]]), 'unsupported_type', 'script_payload');
        }
        // Removed ranges cannot glue a pattern together.
        self::assertSame("<?\0=", TrapScanner::withoutRanges('<?XX=', [[2, 2]]));
        $scanner->scan('<?XX=', [[2, 2]]);
    }

    public function testReencodingNeutralisesTrailingPayload(): void
    {
        // Second line of defence: even without the trap scan, the re-encoded file carries no
        // byte of the polyglot payload.
        $source = self::fixture('trap_polyglot_png_php.png');
        self::assertStringContainsString('<?php', (string) file_get_contents($source));
        $info = (new PngParser())->parse((string) file_get_contents($source));
        $out = $this->work . '/out.png';
        (new Reencoder(new DimensionGuard()))->reencode(Sniffer::PNG, $source, $info, $out);
        $final = (string) file_get_contents($out);
        self::assertStringNotContainsString('<?php', $final);
        self::assertStringEndsWith("IEND\xAE\x42\x60\x82", $final);
    }

    private function gif(array $blocks): string
    {
        return 'GIF89a' . pack('vv', 2, 2) . "\x80\x00\x00" . "\x00\x00\x00\xFF\xFF\xFF" . implode('', $blocks) . "\x3B";
    }

    private function gce(int $delayCs): string
    {
        return "\x21\xF9\x04\x00" . pack('v', $delayCs) . "\x00\x00";
    }

    private function image(): string
    {
        return "\x2C" . pack('vvvv', 0, 0, 2, 2) . "\x00\x02\x02\x44\x01\x00";
    }
}
