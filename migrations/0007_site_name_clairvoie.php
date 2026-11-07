<?php

/*
 * 0007_site_name_clairvoie: the public product name is now "Clairvoie".
 *
 * - settings.site_name: "JDR" (exactly the former default) becomes "Clairvoie"; any other value chosen by the
 *   administrator is kept.
 * Replayable (after the first run no row holds "JDR" any more).
 * NEVER modify this file once delivered: any change = new migration.
 */

declare(strict_types=1);

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Migrate\Migration;
use JDR\Migrate\MigrationLogger;

return new class implements Migration {
    public function up(Db $db, MigrationLogger $log): void
    {
        // Decode in PHP: the column is JSON (MySQL) or LONGTEXT (MariaDB), comparing raw text is not portable.
        $raw = $db->fetchValue('SELECT `value` FROM ' . $db->t('settings') . ' WHERE `key` = ?', ['site_name']);
        if ($raw !== null && $raw !== false && json_decode((string) $raw, true) === 'JDR') {
            $db->execute(
                'UPDATE ' . $db->t('settings') . ' SET `value` = ? WHERE `key` = ?',
                [json_encode('Clairvoie'), 'site_name'],
            );
        }
    }
};
