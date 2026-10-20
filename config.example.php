<?php

// Example configuration. install.php generates the real config.php (never committed).
// For local development: copy to config.php and adjust.

defined('JDR_BOOT') || exit;

return [
    'db' => [
        'host' => '127.0.0.1',
        'port' => 3306,
        'name' => 'jdr_dev',
        'user' => 'root',
        'pass' => '',
        'prefix' => 'jdr_',
    ],
    'base_url' => 'http://localhost:8000',
    'routing_mode' => 'rewrite', // rewrite | query
    'storage_path' => __DIR__ . '/storage',
    'app_secret' => 'change-me-64-random-bytes-hex',
    'cron_key' => 'change-me',
    'debug' => true,
    'cookie_secure' => false,
];
