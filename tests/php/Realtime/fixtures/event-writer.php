<?php

/**
 * Worker of EventOrderConcurrencyTest: writes one event in a transaction that stays open
 * hold_ms milliseconds AFTER its event id is attributed (a slow COMMIT).
 * Usage: php event-writer.php <json args>
 * args: {db, root, storage, mode: "store"|"naive", channel, type, hold_ms, wait_for: ?file, flushed: ?file}
 * - store: JDR\Realtime\EventStore (D1: event_seq lock from the attribution of the id to COMMIT);
 * - naive: plain INSERT INTO events in the middle of the transaction (the P0 behaviour).
 * Prints {id, started, committed} (microtime floats).
 */

declare(strict_types=1);

define('JDR_BOOT', true);
define('JDR_TESTING', true);

$args = json_decode((string) ($argv[1] ?? ''), true, 512, JSON_THROW_ON_ERROR);
require $args['root'] . '/app/bootstrap.php';

use JDR\Core\Clock;
use JDR\Core\Db;
use JDR\Domain\Support\AppPaths;
use JDR\Realtime\ChannelSignal;
use JDR\Realtime\EventStore;

$db = new Db($args['db']);
$db->pdo();
$store = new EventStore($db, new Clock(), new ChannelSignal(new AppPaths($args['root'], $args['storage'], $args['root']), false));
$hold = static function () use ($args): void {
    if (is_string($args['flushed'] ?? null)) {
        touch($args['flushed']);
    }
    usleep(1000 * (int) $args['hold_ms']);
};

if (is_string($args['wait_for'] ?? null)) {
    $limit = microtime(true) + 15;
    while (!is_file($args['wait_for'])) {
        if (microtime(true) > $limit) {
            fwrite(STDERR, "barrier timeout\n");
            exit(2);
        }
        usleep(2000);
    }
}

$started = microtime(true);
$id = $db->transaction(static function (Db $db) use ($args, $store, $hold): ?int {
    if ($args['mode'] === 'naive') {
        $db->execute(
            'INSERT INTO ' . $db->t('events') . ' (`channel`, `type`, `audience`, `payload`, `ephemeral`, `created_at`) '
            . "VALUES (?, ?, 'all', '{}', 0, UTC_TIMESTAMP())",
            [$args['channel'], $args['type']],
        );
        $id = (int) $db->lastInsertId();
        $hold();

        return $id;
    }
    $store->record($args['channel'], $args['type'], 'all', []);
    // Registered after record(): runs after the flush, while the event_seq lock is held.
    $db->beforeCommit(static function () use ($hold): void {
        $hold();
    });

    return null;
});

echo json_encode(['id' => $id ?? $store->lastCommittedId(), 'started' => $started, 'committed' => microtime(true)]), "\n";
