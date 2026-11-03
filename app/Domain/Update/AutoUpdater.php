<?php

declare(strict_types=1);

namespace JDR\Domain\Update;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Db;
use JDR\Core\Logger;
use JDR\Domain\Audit\AuditLog;
use JDR\Domain\Settings\Settings;

/**
 * Automatic update, driven by the cron (real, or pseudo-cron after the response). Two cases:
 * - files uploaded by FTP, newer than the database: the disk-mode run of update.php;
 * - a newer GitHub release on the channel: download, official SHA-256 of SHA256SUMS required
 *   (never an unverified archive) AND a valid Ed25519 signature of SHA256SUMS (sodium required),
 *   then the regular package run.
 * Everything else is the regular runner: maintenance, backups, rollback. A failed migration is
 * restored at once and not tried again for that version; other failures: 3 attempts, 1 h apart.
 * Nothing starts during a session started in the last 12 h, over a package an admin uploaded, or
 * in a development checkout. auto-run.json marks a run in progress: every request then drives it
 * (the site is in maintenance, the pseudo-cron alone would be too rare).
 */
final class AutoUpdater
{
    public const SETTING = 'update_auto';
    public const MAX_ATTEMPTS = 3;
    public const RETRY_SECONDS = 3600;
    public const RUN_TIMEOUT_SECONDS = 3600;
    public const SESSION_GUARD_SECONDS = 43200;
    public const BUDGET_SECONDS = 120.0;
    public const RUN_FILE = 'auto-run.json';
    private const STATE_FILE = 'auto.json';
    private const DOWNLOAD_FILE = 'auto-download.zip';

    private ReleaseDownloader $downloader;
    private ReleaseSignature $signature;

    public function __construct(
        private UpdateStorage $storage,
        private UpdateChecker $checker,
        private UpdatePackage $packages,
        private UpdateRunner $runner,
        private Settings $settings,
        private Db $db,
        private Clock $clock,
        private AuditLog $audit,
        private Logger $logger,
        ?ReleaseDownloader $downloader = null,
        ?ReleaseSignature $signature = null,
    ) {
        $this->downloader = $downloader ?? new NativeReleaseDownloader();
        $this->signature = $signature ?? new ReleaseSignature();
    }

    public function enabled(): bool
    {
        return $this->settings->get(self::SETTING) !== false;
    }

    public function setEnabled(bool $enabled): void
    {
        $this->settings->set(self::SETTING, $enabled);
    }

    /**
     * False in a development checkout or when the environment forbids it (e2e-serve.sh).
     */
    public function supported(): bool
    {
        return !is_dir($this->storage->root() . '/.git') && getenv('JDR_AUTO_UPDATE') !== '0';
    }

    /**
     * For the admin page.
     *
     * blocked: why no automatic update can start (null = nothing in the way): sodium_missing | unsigned | bad_signature.
     *
     * @return array{enabled:bool,supported:bool,running:bool,last_done:mixed,last_error:mixed,blocked:?string}
     */
    public function status(): array
    {
        $state = $this->state();

        return [
            'enabled' => $this->enabled(),
            'supported' => $this->supported(),
            'running' => is_file($this->path(self::RUN_FILE)),
            'last_done' => $state['last_done'] ?? null,
            'last_error' => $state['last_error'] ?? null,
            'blocked' => $this->blocked(),
        ];
    }

    private function blocked(): ?string
    {
        if (!$this->signature->available()) {
            return 'sodium_missing';
        }
        $latest = $this->checker->cached()['latest'] ?? null;
        $asset = is_array($latest) ? ($latest['update_asset'] ?? null) : null;
        if (!is_array($asset)) {
            return null;
        }

        return match ($asset['signature'] ?? 'absent') {
            'valid' => null,
            'invalid' => 'bad_signature',
            default => 'unsigned',
        };
    }

    /**
     * True when a run needs driving (no database access: called on every request).
     */
    public static function runPending(UpdateStorage $storage): bool
    {
        return is_file($storage->dir() . '/' . self::RUN_FILE);
    }

    /**
     * @return string what happened: off, busy, session, pending, wait, none, failed, running, done
     */
    public function tick(float $budget = self::BUDGET_SECONDS): string
    {
        $lock = substr('jdr_auto_update:' . $this->db->prefix(), 0, 64);
        if ((int) $this->db->fetchValue('SELECT GET_LOCK(?, 0)', [$lock]) !== 1) {
            return 'busy';
        }
        try {
            if (function_exists('set_time_limit') && (int) ini_get('max_execution_time') > 0) {
                @set_time_limit((int) $budget + 60); // 0 = no limit (command line): left as it is
            }
            ignore_user_abort(true);
            $run = $this->storage->readJson($this->path(self::RUN_FILE));
            if ($run !== null) {
                return $this->drive($run, $budget); // a started run ends, even if switched off meanwhile
            }
            if (!$this->supported() || !$this->enabled()) {
                return 'off';
            }

            return $this->start($budget);
        } catch (\Throwable $e) {
            $this->logger->error('Automatic update failed', ['error' => $e->getMessage()]);

            return 'failed';
        } finally {
            try {
                $this->db->fetchValue('SELECT RELEASE_LOCK(?)', [$lock]);
            } catch (\Throwable) {
                // Connection lost: the lock is released with it.
            }
        }
    }

    private function start(float $budget): string
    {
        if ($this->storage->busyRun() !== null) {
            return 'busy';
        }
        $state = $this->state();
        if ((int) ($state['retry_at'] ?? 0) > $this->clock->timestamp()) {
            return 'wait';
        }
        $disk = $this->runner->diskStatus(\REQUIRED_DB_VERSION);
        if ($disk !== null) { // the database may be behind: nothing else can be read yet
            return $this->attempts($state, $disk['to']) >= self::MAX_ATTEMPTS
                ? 'none'
                : $this->launch($this->runner->prepareDisk($this->adminId(), \REQUIRED_DB_VERSION), $budget);
        }
        if ($this->sessionInProgress()) {
            return 'session';
        }
        $pending = $this->packages->pending();
        if ($pending !== null && $this->runner->state((string) $pending['id']) === null) {
            return 'pending';
        }
        $latest = $this->checker->check(false)['latest'] ?? null;
        $asset = is_array($latest) ? ($latest['update_asset'] ?? null) : null;
        if (!is_array($asset) || !$this->acceptableAsset($asset)
            || $this->attempts($state, (string) $latest['version']) >= self::MAX_ATTEMPTS) {
            return 'none';
        }
        $version = (string) $latest['version'];
        try {
            $file = $this->fetch($asset);
            $summary = $this->packages->accept($file, $this->adminId());
            $run = $this->runner->prepare((string) $summary['id'], $this->adminId(), false);
        } catch (\Throwable $e) {
            @unlink($this->path(self::DOWNLOAD_FILE));
            $this->recordFailure($version, $e->getMessage(), false);

            return 'failed';
        }

        return $this->launch($run, $budget);
    }

    /**
     * @param array<string, mixed> $asset
     */
    private function acceptableAsset(array $asset): bool
    {
        $prefix = 'https://github.com/' . UpdateChecker::REPOSITORY . '/releases/download/';

        return $this->signature->available() && ($asset['signature'] ?? null) === 'valid'
            && is_string($asset['url'] ?? null) && str_starts_with($asset['url'], $prefix)
            && is_string($asset['sha256'] ?? null) && preg_match('/^[0-9a-f]{64}$/', $asset['sha256']) === 1;
    }

    /**
     * @param array<string, mixed> $asset
     */
    private function fetch(array $asset): string
    {
        $file = $this->path(self::DOWNLOAD_FILE);
        if (!$this->downloader->download((string) $asset['url'], $file, PackageInspector::MAX_BYTES)) {
            throw new \RuntimeException('Download failed: ' . $asset['url']);
        }
        if (!hash_equals((string) $asset['sha256'], (string) hash_file('sha256', $file))) {
            throw new \RuntimeException('The downloaded archive does not match SHA256SUMS.');
        }

        return $file;
    }

    /**
     * @param array<string, mixed> $s
     */
    private function launch(array $s, float $budget): string
    {
        $run = ['id' => (string) $s['id'], 'to' => (string) $s['to'], 'started_at' => $this->clock->timestamp()];
        $this->storage->writeJson($this->path(self::RUN_FILE), $run);

        return $this->drive($run, $budget);
    }

    /**
     * @param array<string, mixed> $run
     */
    private function drive(array $run, float $budget): string
    {
        $id = (string) $run['id'];
        $to = (string) ($run['to'] ?? '');
        $deadline = microtime(true) + $budget;
        do {
            $s = $this->runner->state($id);
            if ($s === null || $this->clock->timestamp() - (int) ($run['started_at'] ?? 0) > self::RUN_TIMEOUT_SECONDS) {
                // update.php still shows a run that did not end, and can take over.
                $this->endRun($to, 'The automatic update did not finish in time.', false);

                return 'failed';
            }
            if ($s['state'] === 'failed_migration') {
                $this->runner->restore($id);
            }
            $s = $this->runner->step($id, min(5.0, max(0.1, $deadline - microtime(true))));
            if (($s['busy'] ?? false) === true) {
                return 'busy';
            }
            if ($s['state'] === 'done') {
                @unlink($this->path(self::RUN_FILE));
                (new PreUpdateBackup($this->storage))->markAuto();
                $this->writeState(['last_done' => ['version' => $to, 'at' => $this->clock->timestamp()]]);

                return 'done';
            }
            if ($s['state'] === 'failed' || $s['state'] === 'restored') {
                $this->endRun($to, (string) ($s['error'] ?? $s['state']), $s['state'] === 'restored');

                return 'failed';
            }
            if ($s['state'] !== 'failed_migration' && ($s['error'] ?? null) !== null) {
                return 'running'; // this slice keeps failing: the next request tries again
            }
        } while (microtime(true) < $deadline);

        return 'running';
    }

    private function endRun(string $version, string $message, bool $final): void
    {
        @unlink($this->path(self::RUN_FILE));
        $this->recordFailure($version, $message, $final);
    }

    private function recordFailure(string $version, string $message, bool $final): void
    {
        $state = $this->state();
        $attempts = is_array($state['attempts'] ?? null) ? $state['attempts'] : [];
        $attempts[$version] = $final ? self::MAX_ATTEMPTS : (int) ($attempts[$version] ?? 0) + 1;
        $now = $this->clock->timestamp();
        $this->writeState([
            'attempts' => $attempts,
            'retry_at' => $now + self::RETRY_SECONDS,
            'last_error' => ['version' => $version, 'message' => $message, 'at' => $now],
            'last_done' => $state['last_done'] ?? null,
        ]);
        $this->logger->error('Automatic update failed', ['version' => $version, 'error' => $message]);
        try {
            $this->audit->record(null, 'update.auto_failed', 'update', null, ['version' => $version, 'error' => $message]);
        } catch (\Throwable) {
            // The audit table may be the problem; the state file and the log keep the failure.
        }
    }

    private function sessionInProgress(): bool
    {
        $since = gmdate('Y-m-d H:i:s', $this->clock->timestamp() - self::SESSION_GUARD_SECONDS);

        return (int) $this->db->fetchValue(
            'SELECT COUNT(*) FROM ' . $this->db->t('play_sessions')
            . " WHERE `state` IN ('running', 'paused') AND `started_at` >= ?",
            [$since],
        ) > 0;
    }

    private function adminId(): int
    {
        $id = $this->db->fetchValue(
            'SELECT `id` FROM ' . $this->db->t('users') . " WHERE `role` = 'admin' AND `status` = 'active' ORDER BY `id` LIMIT 1",
        );
        if ($id === null) {
            throw new \RuntimeException('No active administrator.');
        }

        return (int) $id;
    }

    /**
     * @param array<string, mixed> $state
     */
    private function attempts(array $state, string $version): int
    {
        return (int) ($state['attempts'][$version] ?? 0);
    }

    /**
     * @return array<string, mixed>
     */
    private function state(): array
    {
        return $this->storage->readJson($this->path(self::STATE_FILE)) ?? [];
    }

    /**
     * @param array<string, mixed> $state
     */
    private function writeState(array $state): void
    {
        $this->storage->writeJson($this->path(self::STATE_FILE), $state);
    }

    private function path(string $file): string
    {
        return $this->storage->dir() . '/' . $file;
    }
}
