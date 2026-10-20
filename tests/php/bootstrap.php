<?php

/*
 * PHPUnit bootstrap: constants and autoloaders, without the HTTP runtime
 * (app/bootstrap.php returns early when JDR_TESTING is defined).
 */

declare(strict_types=1);

define('JDR_BOOT', true);
define('JDR_TESTING', true);
define('JDR_ROOT', dirname(__DIR__, 2));

require JDR_ROOT . '/app/bootstrap.php';

// JDR\Tests\Foo\Bar -> tests/php/Foo/Bar.php
spl_autoload_register(static function (string $class): void {
    $prefix = 'JDR\\Tests\\';
    if (strncmp($class, $prefix, strlen($prefix)) !== 0) {
        return;
    }
    $file = __DIR__ . '/' . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
    if (is_file($file)) {
        require $file;
    }
});
