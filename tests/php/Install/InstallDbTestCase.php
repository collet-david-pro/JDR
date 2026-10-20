<?php

declare(strict_types=1);

namespace JDR\Tests\Install;

use JDR\Core\Db;
use JDR\Tests\Support\DbTestCase;

require_once __DIR__ . '/../Support/DbTestCase.php';

/**
 * Installer tests use their own table prefix ("jdri_") in the test database, so that they never
 * collide with the other suites (prefix "jdrt_").
 */
abstract class InstallDbTestCase extends DbTestCase
{
    public const PREFIX = 'jdri_';

    /**
     * @return array{host:string,port:int,name:string,user:string,pass:string,prefix:string}
     */
    protected static function installDbConfig(): array
    {
        return ['prefix' => self::PREFIX] + self::dbConfig();
    }

    protected static function installDb(): Db
    {
        return new Db(self::installDbConfig());
    }
}
