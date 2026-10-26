<?php

/**
 * Worker of ActionsConcurrencyTest: a real PHP process that, after the barrier file appears,
 * sends <lots> requests through ActionService (mode "move": token.move of <uid> to x = 10 + lot)
 * or MapOpsService (mode "ops": an object added near the tokens, D10 events).
 * Usage: php actions-worker.php <json args>
 * args: {db, root, session_id, map_id, floor_id, user_id, worker, mode, uid, lots, barrier}
 * Prints one JSON line per request: {lot, last_event_id | revision}.
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
use JDR\Domain\Sessions\Actions\ActionService;
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
if ($user === null) {
    fwrite(STDERR, "no user\n");
    exit(2);
}
$actions = $app->container()->get(ActionService::class);
$ops = $app->container()->get(MapOpsService::class);

$deadline = microtime(true) + 20;
while (!is_file($args['barrier']) && microtime(true) < $deadline) {
    usleep(1000);
}

$w = (int) $args['worker'];
for ($lot = 0; $lot < (int) $args['lots']; $lot++) {
    if ($args['mode'] === 'move') {
        $r = $actions->apply($user, (int) $args['session_id'], [
            'client_op_id' => 'cc-' . $w . '-' . $lot,
            'actions' => [['type' => 'token.move', 'uid' => $args['uid'], 'x' => 10 + $lot, 'y' => 5 + $w]],
        ]);
        echo json_encode(['lot' => $lot, 'last_event_id' => $r['last_event_id']]), "\n";
        continue;
    }
    $r = $ops->apply($user, (int) $args['map_id'], [
        'base_revision' => 0,
        'client_op_id' => 'cc-ops-' . $w . '-' . $lot,
        'ops' => [['type' => 'object.add', 'object' => [
            'uid' => 'cc' . $w . '-' . $lot, 'floor' => (string) $args['floor_id'], 'type' => 'wall', 'layer' => 'walls',
            'geometry' => ['points' => [[30, $lot], [31, $lot]], 'closed' => false],
            'props' => ['kind' => 'stone', 'thickness' => 0.15, 'blocks_vision' => true, 'blocks_light' => true, 'blocks_move' => true, 'texture_asset' => null, 'height' => null],
            'visibility' => 'all', 'locked' => false, 'sort_order' => 0,
        ]]],
    ]);
    echo json_encode(['lot' => $lot, 'revision' => $r['revision']]), "\n";
}
