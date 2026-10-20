<?php

declare(strict_types=1);

namespace JDR\Core;

defined('JDR_BOOT') || exit;

/**
 * Real cron entry point (cron.php?key=<cron_key>). Tasks are added in later phases (projet.md 6.5).
 */
final class Cron
{
    public function __construct(private ?Config $config, private Logger $logger)
    {
    }

    /**
     * @return int HTTP status: 204 done, 403 bad key, 503 not installed
     */
    public function run(string $providedKey): int
    {
        if ($this->config === null) {
            return 503;
        }
        $expected = $this->config->cronKey();
        if ($expected === '' || $providedKey === '' || !hash_equals($expected, $providedKey)) {
            $this->logger->warning('Cron: invalid key');

            return 403;
        }
        // TODO(P1+): run the idempotent maintenance tasks of projet.md 6.5 under GET_LOCK('jdr_cron', 0).
        $this->logger->debug('Cron: run');

        return 204;
    }
}
