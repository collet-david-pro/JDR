<?php

declare(strict_types=1);

namespace JDR\Tests\Install;

use JDR\Install\ConfigWriter;
use JDR\Install\Secrets;
use PHPUnit\Framework\TestCase;

final class ConfigWriterTest extends TestCase
{
    private string $dir;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir() . '/jdr-cfg-' . bin2hex(random_bytes(6));
        mkdir($this->dir, 0700, true);
    }

    protected function tearDown(): void
    {
        foreach (glob($this->dir . '/{,.}*', GLOB_BRACE) ?: [] as $f) {
            if (is_file($f)) {
                unlink($f);
            }
        }
        @chmod($this->dir, 0700);
        @rmdir($this->dir);
    }

    /**
     * @return array<string, mixed>
     */
    private static function values(?string $storage = null): array
    {
        return [
            'db' => ['host' => '127.0.0.1', 'port' => 3307, 'name' => 'jdr', 'user' => "o'brien", 'pass' => "p'a\$s\\w\"d{\$x}", 'prefix' => 'jdr_'],
            'base_url' => 'https://example.org/jdr',
            'routing_mode' => 'query',
            'storage_path' => $storage,
            'app_secret' => Secrets::appSecret(),
            'cron_key' => Secrets::cronKey(),
            'cookie_secure' => true,
        ];
    }

    public function testWrittenFileIsValidPhpReturningTheConfig(): void
    {
        $values = self::values('/srv/jdr-storage');
        $path = $this->dir . '/config.php';
        self::assertTrue(ConfigWriter::writeAtomic($path, ConfigWriter::render($values)));

        exec(escapeshellarg(PHP_BINARY) . ' -l ' . escapeshellarg($path) . ' 2>&1', $out, $code);
        self::assertSame(0, $code, implode("\n", $out));

        $content = (string) file_get_contents($path);
        self::assertStringStartsWith("<?php\n", $content);
        self::assertStringContainsString("defined('JDR_BOOT') || exit;", $content);
        self::assertStringContainsString('return [', $content);

        $config = ConfigWriter::read($path);
        self::assertIsArray($config);
        self::assertSame($values['db'], $config['db']);
        self::assertSame('https://example.org/jdr', $config['base_url']);
        self::assertSame('query', $config['routing_mode']);
        self::assertSame('/srv/jdr-storage', $config['storage_path']);
        self::assertSame($values['app_secret'], $config['app_secret']);
        self::assertSame($values['cron_key'], $config['cron_key']);
        self::assertFalse($config['debug']);
        self::assertTrue($config['cookie_secure']);
    }

    public function testDefaultStorageIsRelativeToTheConfigFile(): void
    {
        $content = ConfigWriter::render(self::values());
        self::assertStringContainsString("'storage_path' => __DIR__ . '/storage',", $content);

        $path = $this->dir . '/config.php';
        ConfigWriter::writeAtomic($path, $content);
        self::assertSame(realpath($this->dir) . '/storage', ConfigWriter::read($path)['storage_path'] ?? null);
    }

    public function testGuardStopsDirectExecution(): void
    {
        $path = $this->dir . '/config.php';
        ConfigWriter::writeAtomic($path, ConfigWriter::render(self::values()));
        // Without JDR_BOOT (direct HTTP hit), the file exits before returning anything.
        exec(escapeshellarg(PHP_BINARY) . ' -r ' . escapeshellarg('var_export(include $argv[1]); echo "after";') . ' ' . escapeshellarg($path), $out, $code);
        self::assertSame(0, $code);
        self::assertSame('', implode('', $out));
    }

    public function testAtomicWriteLeavesNoTemporaryFileAndSetsMode(): void
    {
        $path = $this->dir . '/config.php';
        self::assertTrue(ConfigWriter::writeAtomic($path, 'first'));
        self::assertTrue(ConfigWriter::writeAtomic($path, 'second'));
        self::assertSame('second', file_get_contents($path));
        self::assertSame(['config.php'], array_values(array_diff(scandir($this->dir) ?: [], ['.', '..'])));
        clearstatcache();
        self::assertSame(0640, fileperms($path) & 0777);
    }

    public function testUnwritableFolderIsReported(): void
    {
        self::assertFalse(ConfigWriter::writeAtomic($this->dir . '/missing/config.php', 'x'));
        if (function_exists('posix_geteuid') && posix_geteuid() === 0) {
            return; // root ignores permissions
        }
        chmod($this->dir, 0500);
        self::assertFalse(ConfigWriter::writeAtomic($this->dir . '/config.php', 'x'));
        chmod($this->dir, 0700);
        self::assertFileDoesNotExist($this->dir . '/config.php');
    }

    public function testReadRejectsInvalidFiles(): void
    {
        self::assertNull(ConfigWriter::read($this->dir . '/none.php'));
        file_put_contents($this->dir . '/bad.php', "<?php\nreturn 'nope';\n");
        self::assertNull(ConfigWriter::read($this->dir . '/bad.php'));
    }
}
