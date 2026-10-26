<?php

declare(strict_types=1);

namespace JDR\Core;

defined('JDR_BOOT') || exit;

use JDR\Domain\Assets\AssetHousekeeping;
use JDR\Domain\Auth\LoginAttempts;
use JDR\Domain\Games\GameHousekeeping;
use JDR\Domain\Maps\MapHousekeeping;
use JDR\Domain\Maps\Transfer\MapThumbnailService;
use JDR\Domain\Maps\Versions\MapVersionService;
use JDR\Domain\Auth\PasswordResets;
use JDR\Domain\Sessions\SessionHousekeeping;
use JDR\Domain\Settings\Settings;
use JDR\Realtime\EventPurger;

/**
 * Housekeeping tasks (projet.md 6.5): real cron (cron.php?key=<cron_key>) or pseudo-cron
 * at the end of 2 % of requests. Tasks are idempotent and run under GET_LOCK('jdr_cron…', 0).
 */
final class Cron
{
    public const PSEUDO_PROBABILITY = 0.02;
    public const PSEUDO_BUDGET_S = 2.0;

    public function __construct(
        private ?Config $config,
        private Logger $logger,
        private ?Container $container = null,
    ) {
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
        $this->runTasks(30.0);

        return 204;
    }

    /**
     * Pseudo-cron hook, called after the response has been sent.
     */
    public function maybeRunPseudo(): void
    {
        if ($this->config === null || mt_rand() / mt_getrandmax() >= self::PSEUDO_PROBABILITY) {
            return;
        }
        $this->runTasks(self::PSEUDO_BUDGET_S);
    }

    /**
     * Runs every task until the time budget is spent. Returns the names of the tasks run.
     *
     * @return list<string>
     */
    public function runTasks(float $budgetSeconds): array
    {
        if ($this->container === null || !$this->container->has(Db::class)) {
            return [];
        }
        $db = $this->container->get(Db::class);
        $lock = 'jdr_cron:' . $db->prefix() . '@' . $this->config?->db()['name'];
        $done = [];
        try {
            if ((int) $db->fetchValue('SELECT GET_LOCK(?, 0)', [substr($lock, 0, 64)]) !== 1) {
                return [];
            }
            $deadline = microtime(true) + $budgetSeconds;
            foreach ($this->tasks() as $name => $task) {
                if (microtime(true) >= $deadline) {
                    break;
                }
                $count = $task();
                $done[] = $name;
                $this->logger->debug('Cron task done', ['task' => $name, 'rows' => $count]);
            }
            $this->container->get(Settings::class)->set('cron_last_run', gmdate('Y-m-d H:i:s'));
        } catch (\Throwable $e) {
            $this->logger->error('Cron failed', ['error' => $e->getMessage()]);
        } finally {
            try {
                $db->fetchValue('SELECT RELEASE_LOCK(?)', [substr($lock, 0, 64)]);
            } catch (\Throwable) {
                // Connection lost: the lock is released with it.
            }
        }

        return $done;
    }

    /**
     * @return array<string, \Closure(): int>
     */
    private function tasks(): array
    {
        $c = $this->container;
        assert($c !== null);

        return [
            'rate_limits' => static fn (): int => $c->get(RateLimiter::class)->purge(),
            'login_attempts' => static fn (): int => $c->get(LoginAttempts::class)->purge(),
            'password_resets' => static fn (): int => $c->get(PasswordResets::class)->purgeExpired(),
            'assets_tmp' => static fn (): int => $c->get(AssetHousekeeping::class)->purgeTmp(),
            'assets_job_files' => static fn (): int => $c->get(AssetHousekeeping::class)->purgeJobFiles(),
            'assets_trash' => static fn (): int => $c->get(AssetHousekeeping::class)->purgeTrash(),
            'games_trash' => static fn (): int => $c->get(GameHousekeeping::class)->purgeTrash(),
            'maps_trash' => static fn (): int => $c->get(MapHousekeeping::class)->purgeTrash(),
            'processed_ops' => static fn (): int => $c->get(MapHousekeeping::class)->purgeProcessedOps(),
            'map_versions' => static fn (): int => $c->get(MapVersionService::class)->trim(
                $c->get(Settings::class)->int('versions_retention'),
            ),
            'map_thumbs' => static fn (): int => $c->get(MapThumbnailService::class)->purgeOrphans(),
            'events' => static fn (): int => $c->get(EventPurger::class)->purge(),
            'presence' => static fn (): int => $c->get(SessionHousekeeping::class)->sweepPresence(),
            'sessions' => static fn (): int => $c->get(SessionHousekeeping::class)->purgeEnded(),
        ];
    }
}
