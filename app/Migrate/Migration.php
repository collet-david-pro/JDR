<?php

declare(strict_types=1);

namespace JDR\Migrate;

use JDR\Core\Db;

defined('JDR_BOOT') || exit;

/**
 * Contract of a PHP migration file (migrations/NNNN_name.php).
 *
 * The file must `return new class implements \JDR\Migrate\Migration { ... };`
 * and be replayable after a partial failure (projet.md §8.2).
 */
interface Migration
{
    public function up(Db $db, MigrationLogger $log): void;
}
