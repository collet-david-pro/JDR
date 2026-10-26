<?php

/**
 * Worker of MapSceneConcurrencyTest (projet.md 21: concurrent map ops from two processes).
 * Usage: php scene-worker.php <json args>
 * args: {db, root, map_id, floor_id, user_id, worker (0|1), lots, barrier}
 * Waits for the barrier file, then sends <lots> lots through MapOpsService: each adds its own
 * light and updates the shared wall "shared" with the last rev this worker knows (taken from a
 * stale conflict). Prints one JSON line per lot: {lot, sent_rev, revision, applied, conflicts}.
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
$floor = (string) $args['floor_id'];
$rev = 1;
for ($lot = 0; $lot < (int) $args['lots']; $lot++) {
    $ops = [
        ['type' => 'object.add', 'object' => [
            'uid' => 'w' . $worker . '-' . $lot, 'floor' => $floor, 'type' => 'light', 'layer' => 'lighting',
            'geometry' => ['x' => $lot, 'y' => $worker],
            'props' => ['radius' => 1, 'dim_radius' => 2, 'color' => '#ffffff', 'intensity' => 1,
                'flicker' => ['type' => 'none', 'amp' => 0, 'speed' => 1], 'cone' => null, 'enabled' => true, 'follows_token' => null],
            'visibility' => 'all', 'locked' => false, 'sort_order' => 0,
        ]],
        ['type' => 'object.update', 'uid' => 'shared', 'rev' => $rev, 'patch' => ['sort_order' => $worker * 1000 + $lot]],
    ];
    $result = $service->apply($user, (int) $args['map_id'], [
        'base_revision' => 0,
        'client_op_id' => 'scene-w' . $worker . '-' . $lot,
        'ops' => $ops,
    ]);
    $sent = $rev;
    $conflict = $result['conflicts'][0] ?? null;
    $rev = $conflict === null ? $rev + 1 : (int) $conflict['current']['rev'];
    echo json_encode(['lot' => $lot, 'sent_rev' => $sent] + $result), "\n";
}
