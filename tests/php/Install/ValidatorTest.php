<?php

declare(strict_types=1);

namespace JDR\Tests\Install;

use JDR\Install\Validator;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class ValidatorTest extends TestCase
{
    private const DB = ['host' => 'localhost', 'port' => '3306', 'name' => 'jdr', 'user' => 'u', 'pass' => 'p', 'prefix' => 'jdr_'];
    private const SITE = [
        'site_name' => 'Ma table', 'base_url' => 'https://example.org/jdr/', 'default_locale' => 'fr',
        'registration_mode' => 'invite', 'default_quota_mb' => '500', 'max_upload_mb' => '10',
        'max_dimension_px' => '4096', 'storage' => 'default', 'storage_custom' => '',
    ];
    private const ADMIN = [
        'email' => ' Admin@Example.ORG ', 'username' => 'Maître du jeu', 'password' => 'correct horse battery',
        'password_confirm' => 'correct horse battery',
    ];

    public function testValidDatabase(): void
    {
        [$clean, $errors] = Validator::database(self::DB + ['create_db' => '1']);
        self::assertSame([], $errors);
        self::assertSame(3306, $clean['port']);
        self::assertTrue($clean['create_db']);
        self::assertSame('jdr_', $clean['prefix']);
    }

    /**
     * @return array<string, array{array<string, string>, string, string}>
     */
    public static function badDatabase(): array
    {
        return [
            'empty host' => [['host' => ''], 'host', 'required'],
            'host with space' => [['host' => 'local host'], 'host', 'invalid'],
            'port text' => [['port' => 'abc'], 'port', 'invalid'],
            'port too big' => [['port' => '70000'], 'port', 'invalid'],
            'name missing' => [['name' => ''], 'name', 'required'],
            'name quote' => [['name' => 'a`b'], 'name', 'db_name'],
            'user missing' => [['user' => ''], 'user', 'required'],
            'prefix digit' => [['prefix' => '1jdr_'], 'prefix', 'prefix'],
            'prefix too long' => [['prefix' => 'abcdefghijklmnopq'], 'prefix', 'prefix'],
            'prefix dash' => [['prefix' => 'jdr-'], 'prefix', 'prefix'],
        ];
    }

    /**
     * @param array<string, string> $override
     */
    #[DataProvider('badDatabase')]
    public function testInvalidDatabase(array $override, string $field, string $code): void
    {
        [, $errors] = Validator::database($override + self::DB);
        self::assertSame($code, $errors[$field] ?? null);
    }

    public function testPrefixIsLowerCasedAndEmptyPortDefaults(): void
    {
        [$clean, $errors] = Validator::database(['prefix' => 'JDR_', 'port' => ''] + self::DB);
        self::assertSame([], $errors);
        self::assertSame('jdr_', $clean['prefix']);
        self::assertSame(3306, $clean['port']);
    }

    public function testValidSiteConvertsUnits(): void
    {
        [$clean, $errors] = Validator::site(self::SITE);
        self::assertSame([], $errors);
        self::assertSame('https://example.org/jdr', $clean['base_url']);
        self::assertSame(524288000, $clean['default_quota_bytes']);
        self::assertSame(10485760, $clean['max_upload_bytes']);
        self::assertSame(4096, $clean['max_dimension_px']);
        self::assertSame('invite', $clean['registration_mode']);
    }

    /**
     * @return array<string, array{array<string, string>, string, string}>
     */
    public static function badSite(): array
    {
        return [
            'no name' => [['site_name' => '  '], 'site_name', 'required'],
            'html name' => [['site_name' => '<b>x</b>'], 'site_name', 'invalid'],
            'ftp url' => [['base_url' => 'ftp://example.org'], 'base_url', 'base_url'],
            'url with query' => [['base_url' => 'https://example.org/?a=1'], 'base_url', 'base_url'],
            'bad mode' => [['registration_mode' => 'public'], 'registration_mode', 'invalid'],
            'bad locale' => [['default_locale' => 'xx'], 'default_locale', 'invalid'],
            'quota zero' => [['default_quota_mb' => '0'], 'default_quota_mb', 'range'],
            'upload too big' => [['max_upload_mb' => '4096'], 'max_upload_mb', 'range'],
            'dimension text' => [['max_dimension_px' => 'big'], 'max_dimension_px', 'range'],
            'relative storage' => [['storage' => 'custom', 'storage_custom' => 'data/storage'], 'storage_custom', 'absolute_path'],
            'dotdot storage' => [['storage' => 'custom', 'storage_custom' => '/home/a/../b'], 'storage_custom', 'absolute_path'],
        ];
    }

    /**
     * @param array<string, string> $override
     */
    #[DataProvider('badSite')]
    public function testInvalidSite(array $override, string $field, string $code): void
    {
        [, $errors] = Validator::site($override + self::SITE);
        self::assertSame($code, $errors[$field] ?? null);
    }

    public function testValidAdmin(): void
    {
        [$clean, $errors] = Validator::admin(self::ADMIN);
        self::assertSame([], $errors);
        self::assertSame('admin@example.org', $clean['email']);
        self::assertSame('Maître du jeu', $clean['username']);
    }

    /**
     * @return array<string, array{array<string, string>, string, string}>
     */
    public static function badAdmin(): array
    {
        return [
            'email' => [['email' => 'not-an-email'], 'email', 'email'],
            'short username' => [['username' => 'ab'], 'username', 'username'],
            'username symbols' => [['username' => 'bad<name>'], 'username', 'username'],
            'short password' => [['password' => 'short', 'password_confirm' => 'short'], 'password', 'too_short'],
            'common password' => [['password' => 'qwertyuiop', 'password_confirm' => 'qwertyuiop'], 'password', 'too_common'],
            'mismatch' => [['password_confirm' => 'something else entirely'], 'password_confirm', 'mismatch'],
            'missing password' => [['password' => ''], 'password', 'required'],
        ];
    }

    /**
     * @param array<string, string> $override
     */
    #[DataProvider('badAdmin')]
    public function testInvalidAdmin(array $override, string $field, string $code): void
    {
        [, $errors] = Validator::admin($override + self::ADMIN);
        self::assertSame($code, $errors[$field] ?? null);
    }

    public function testNonStringInputsAreTreatedAsEmpty(): void
    {
        [, $errors] = Validator::admin(['email' => ['x'], 'username' => 42]);
        self::assertSame('required', $errors['email']);
        self::assertSame('required', $errors['username']);
    }
}
