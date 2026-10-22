<?php

/**
 * Worker of MapConcurrencyTest (projet.md 21: concurrent map ops from two processes).
 * Usage: php ops-worker.php <json args>
 * args: {db, root, map_id, floor_id, user_id, worker (0|1), lots, barrier}
 * Waits for the barrier file, then sends <lots> lots of ops through MapOpsService (real
 * transactions and row locks) and prints one JSON line per lot: {lot, revision, applied}.
 */

declare(strict_types=1);

define('JDR_BOOT', true);
define('JDR_TESTING', true);

$args = json_decode((string) ($argv[1] ?? ''), true, 512, JSON_THROW_ON_ERROR);
require $args['root'] . '/app/bootstrap.php';

use JDR\Core\App;
use JDR\Core\Config;
use JDR\Core\Logger;
use JDR\Domain\Maps\MapOpsService;
use JDR\Domain\Users\UserRepository;

$config = new Config([
    'db' => $args['db'],
    'base_url' => 'http://jdr.test',
    'routing_mode' => 'rewrite',
    'storage_path' => sys_get_temp_dir(),
    'app_secret' => str_repeat('0123456789abcdef', 4),
    'cron_key' => 'cron',
]);
$app = App::create($args['root'], $config, Logger::discard());
$user = $app->container()->get(UserRepository::class)->find((int) $args['user_id']);
$service = $app->container()->get(MapOpsService::class);
if ($user === null) {
    fwrite(STDERR, "no user\n");
    exit(2);
}

$deadline = microtime(true) + 20;
while (!is_file($args['barrier']) && microtime(true) < $deadline) {
    usleep(1000);
}

$worker = (int) $args['worker'];
for ($lot = 0; $lot < (int) $args['lots']; $lot++) {
    $row = [];
    for ($x = 0; $x < 64; $x++) {
        $row[] = [$x, 2 * $lot + $worker, 1 + $worker, $lot, $worker];
    }
    $ops = [
        ['type' => 'tiles.set', 'floor' => (string) $args['floor_id'], 'layer' => 'ground', 'cells' => $row],
        // Contested cell, written by both workers in every lot (last writer wins).
        ['type' => 'tiles.set', 'floor' => (string) $args['floor_id'], 'layer' => 'terrain', 'cells' => [[5, 70, 1 + $worker, $lot, 0]]],
    ];
    $result = $service->apply($user, (int) $args['map_id'], [
        'base_revision' => 0,
        'client_op_id' => 'w' . $worker . '-lot-' . $lot,
        'ops' => $ops,
    ]);
    echo json_encode(['lot' => $lot] + $result), "\n";
}
