<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

/*
 * PSR-4 autoloader: JDR\Foo\Bar -> app/Foo/Bar.php
 */
spl_autoload_register(static function (string $class): void {
    $prefix = 'JDR\\';
    if (strncmp($class, $prefix, strlen($prefix)) !== 0) {
        return;
    }
    $relative = substr($class, strlen($prefix));
    $file = __DIR__ . '/' . str_replace('\\', '/', $relative) . '.php';
    if (is_file($file)) {
        require $file;
    }
});
