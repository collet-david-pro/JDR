<?php

declare(strict_types=1);

namespace JDR\Tests\Assets;

use JDR\Zip\ZipException;
use JDR\Zip\ZipLimits;
use JDR\Zip\ZipReader;
use JDR\Zip\ZipWriter;
use PHPUnit\Framework\TestCase;

require_once dirname(__DIR__) . '/Support/boot.php';

/**
 * Pure-PHP ZIP reader / writer: round trips (both decompression backends), resumable writing,
 * and the protections (zip slip, links, bombs, sizes, entries, encryption, ZIP64, CRC).
 */
final class ZipTest extends TestCase
{
    private string $dir;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir() . '/jdr-zip-' . bin2hex(random_bytes(4));
        mkdir($this->dir);
    }

    protected function tearDown(): void
    {
        foreach (glob($this->dir . '/*') ?: [] as $file) {
            @unlink($file);
        }
        @rmdir($this->dir);
    }

    /**
     * @return array<string, array{0: bool}>
     */
    public static function backends(): array
    {
        return ['pure php' => [false], 'ext-zip' => [true]];
    }

    /**
     * @dataProvider backends
     */
    public function testRoundTripWithResume(bool $extension): void
    {
        if ($extension && !class_exists(\ZipArchive::class)) {
            self::markTestSkipped('ext-zip not available');
        }
        $source = $this->dir . '/source.bin';
        file_put_contents($source, random_bytes(200000));
        $zip = $this->dir . '/out.zip';

        $writer = ZipWriter::create($zip);
        $writer->addFile('assets/0001-a.bin', $source);
        $state = $writer->state();
        $writer->close();
        // Garbage of an interrupted slice is cut on resume.
        file_put_contents($zip, 'partial garbage', FILE_APPEND);
        $writer = ZipWriter::resume($zip, json_decode((string) json_encode($state), true));
        $writer->addString('pack.json', str_repeat('{"a":1}', 1000));
        $writer->addString('notes/é.txt', 'données', false);
        $writer->finish();

        $reader = new ZipReader($zip, new ZipLimits(), $extension);
        self::assertSame($extension, $reader->usesExtension());
        self::assertSame(['assets/0001-a.bin', 'pack.json', 'notes/é.txt'], array_map(static fn ($e) => $e->name, $reader->entries()));
        $entry = $reader->find('assets/0001-a.bin');
        self::assertNotNull($entry);
        $reader->extractTo($entry, $this->dir . '/x.bin');
        self::assertFileEquals($source, $this->dir . '/x.bin');
        self::assertSame(str_repeat('{"a":1}', 1000), $reader->read($reader->find("pack.json"), 1 << 20));
        self::assertSame('données', $reader->read($reader->find('notes/é.txt'), 100));
        $reader->close();

        if (class_exists(\ZipArchive::class)) {
            $za = new \ZipArchive();
            self::assertTrue($za->open($zip));
            self::assertSame(3, $za->numFiles);
            self::assertSame('données', $za->getFromName('notes/é.txt'));
            $za->close();
        }
    }

    public function testReadsArchivesOfExtZip(): void
    {
        if (!class_exists(\ZipArchive::class)) {
            self::markTestSkipped('ext-zip not available');
        }
        $zip = $this->dir . '/za.zip';
        $za = new \ZipArchive();
        $za->open($zip, \ZipArchive::CREATE);
        $za->addFromString('dir/a.txt', str_repeat('abc', 5000));
        $za->addEmptyDir('empty');
        $za->close();
        $reader = new ZipReader($zip, new ZipLimits(), false);
        self::assertSame(['dir/a.txt'], array_map(static fn ($e) => $e->name, $reader->files()));
        self::assertSame(str_repeat('abc', 5000), $reader->read($reader->files()[0], 1 << 20));
    }

    /**
     * @return array<string, array{0: array<string, mixed>, 1: string}>
     */
    public static function maliciousEntries(): array
    {
        return [
            'zip slip ..' => [['name' => '../../evil.php'], 'unsafe_path'],
            'zip slip inner ..' => [['name' => 'a/../../evil.php'], 'unsafe_path'],
            'absolute path' => [['name' => '/etc/passwd'], 'unsafe_path'],
            'windows drive' => [['name' => 'C:/evil.png'], 'unsafe_path'],
            'backslash' => [['name' => '..\\evil.png'], 'unsafe_path'],
            'nul byte' => [['name' => "a.png\0.php"], 'unsafe_path'],
            'empty segment' => [['name' => 'a//b.png'], 'unsafe_path'],
            'invalid utf-8' => [['name' => "a\xff.png"], 'unsafe_path'],
            'symlink' => [['name' => 'link.png', 'data' => '/etc/passwd', 'attr' => 0120777 << 16], 'symlink'],
            'encrypted' => [['name' => 'a.png', 'flags' => 1], 'encrypted'],
            'bzip2' => [['name' => 'a.png', 'method' => 12], 'unsupported_method'],
            'zip64 marker' => [['name' => 'a.png', 'size' => 0xFFFFFFFF], 'zip64_unsupported'],
            'stored size lie' => [['name' => 'a.png', 'size' => 10], 'corrupt'],
        ];
    }

    /**
     * @dataProvider maliciousEntries
     * @param array<string, mixed> $entry
     */
    public function testMaliciousEntriesAreRefused(array $entry, string $reason): void
    {
        $zip = $this->dir . '/bad.zip';
        file_put_contents($zip, RawZip::build([$entry]));
        $this->assertZipRefused($zip, $reason);
    }

    public function testDuplicateNamesAreRefused(): void
    {
        $zip = $this->dir . '/dup.zip';
        file_put_contents($zip, RawZip::build([['name' => 'a.png'], ['name' => 'a.png']]));
        $this->assertZipRefused($zip, 'duplicate_entry');
    }

    public function testTooManyEntries(): void
    {
        $zip = $this->dir . '/many.zip';
        $entries = [];
        for ($i = 0; $i < 11; $i++) {
            $entries[] = ['name' => 'f' . $i . '.png'];
        }
        file_put_contents($zip, RawZip::build($entries));
        $this->assertZipRefused($zip, 'too_many_entries', new ZipLimits(maxEntries: 10));
    }

    public function testZipBombRatioAndSizes(): void
    {
        $zip = $this->dir . '/bomb.zip';
        $writer = ZipWriter::create($zip);
        $writer->addString('zeros.bin', str_repeat("\0", 5 * 1048576));
        $writer->finish();
        $this->assertZipRefused($zip, 'compression_ratio');
        $this->assertZipRefused($zip, 'entry_too_large', new ZipLimits(maxEntryBytes: 1048576, maxRatio: 100000));
        $this->assertZipRefused($zip, 'too_large', new ZipLimits(maxTotalBytes: 1048576, maxRatio: 100000));
    }

    public function testDeclaredSizeLieIsCaughtWhileInflating(): void
    {
        $data = str_repeat('A', 10000);
        $zip = $this->dir . '/lie.zip';
        file_put_contents($zip, RawZip::build([['name' => 'a.txt', 'data' => $data, 'method' => 8, 'size' => 100]]));
        foreach ([false, true] as $extension) {
            if ($extension && !class_exists(\ZipArchive::class)) {
                continue;
            }
            $reader = new ZipReader($zip, new ZipLimits(), $extension);
            try {
                $reader->read($reader->files()[0], 1 << 20);
                self::fail('Size lie not detected');
            } catch (ZipException $e) {
                self::assertContains($e->reason(), ['size_mismatch', 'corrupt']);
            }
            $reader->close();
        }
    }

    public function testCrcMismatch(): void
    {
        $zip = $this->dir . '/crc.zip';
        file_put_contents($zip, RawZip::build([['name' => 'a.txt', 'data' => 'hello', 'crc' => 12345]]));
        $reader = new ZipReader($zip, new ZipLimits(), false);
        try {
            $reader->read($reader->files()[0], 100);
            self::fail('CRC mismatch not detected');
        } catch (ZipException $e) {
            self::assertSame('crc_mismatch', $e->reason());
        }
    }

    public function testNotAZip(): void
    {
        $file = $this->dir . '/x.zip';
        file_put_contents($file, str_repeat('not a zip ', 10));
        $this->assertZipRefused($file, 'not_zip');
    }

    public function testWriterRefusesUnsafeNames(): void
    {
        $writer = ZipWriter::create($this->dir . '/w.zip');
        $this->expectException(ZipException::class);
        $writer->addString('../evil', 'x');
    }

    private function assertZipRefused(string $zip, string $reason, ?ZipLimits $limits = null): void
    {
        try {
            new ZipReader($zip, $limits ?? new ZipLimits(), false);
            self::fail('Archive accepted, expected ' . $reason);
        } catch (ZipException $e) {
            self::assertSame($reason, $e->reason(), $e->getMessage());
        }
    }
}
