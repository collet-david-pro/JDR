<?php

declare(strict_types=1);

namespace JDR\Install;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Migrate\CallbackLogger;
use JDR\Migrate\MigrationFailedException;
use JDR\Migrate\MigrationLockedException;
use JDR\Migrate\Runner;

/**
 * Step 5 (projet.md 19): one unit of work per HTTP request, resumable at any point.
 *
 * Phases: start -> migrate (one migration per request) -> site (settings + admin) -> storage
 * -> config (or await_config when the root is not writable) -> lock -> done.
 * Every phase is idempotent: replaying one after an interruption is harmless, and the migration
 * engine knows which migrations are already applied.
 */
final class Installation
{
    public const PHASES = ['start', 'migrate', 'site', 'storage', 'config', 'await_config', 'lock', 'done'];

    private ?Db $db = null;

    public function __construct(private Env $env, private State $state)
    {
    }

    /**
     * @return array{phase:string, log:list<string>, error:?string, progress:array{done:int,total:int}}
     */
    public function run(): array
    {
        $run = $this->runState();
        $run['error'] = null;
        $phase = (string) $run['phase'];
        try {
            $run = match ($phase) {
                'start' => $this->start($run),
                'migrate' => $this->migrate($run),
                'site' => $this->site($run),
                'storage' => $this->storage($run),
                'config', 'await_config' => $this->config($run),
                'lock' => $this->lock($run),
                default => $run,
            };
        } catch (MigrationLockedException) {
            $run['log'][] = Strings::t('run.log.locked');
        } catch (MigrationFailedException $e) {
            $run['error'] = Strings::t('run.error.migration', ['version' => $e->version, 'message' => $e->getMessage()]);
        } catch (\Throwable $e) {
            $run['error'] = Strings::t('run.error.generic', ['message' => self::clean($e->getMessage())]);
        }
        $run['log'] = array_slice($run['log'], -200);
        $this->state->set('run', $run);

        return [
            'phase' => (string) $run['phase'],
            'log' => $run['log'],
            'error' => $run['error'],
            'progress' => $this->progress($run),
        ];
    }

    /**
     * Initial run state (called when the user confirms the summary).
     *
     * @return array<string, mixed>
     */
    public static function initial(): array
    {
        return [
            'phase' => 'start',
            'log' => [],
            'error' => null,
            'app_secret' => Secrets::appSecret(),
            'cron_key' => Secrets::cronKey(),
            'generated_at' => gmdate('Y-m-d H:i:s'),
            'started_at' => microtime(true),
            'migrations_total' => 0,
            'migrations_done' => 0,
        ];
    }

    /**
     * config.php content of this installation (also shown when it must be copied by hand).
     */
    public function configContent(): string
    {
        $run = $this->runState();
        $db = $this->dbConfig();
        $site = (array) $this->state->get('site', []);
        $req = (array) $this->state->get('req', []);

        return ConfigWriter::render([
            'db' => $db,
            'base_url' => (string) ($site['base_url'] ?? $this->env->baseUrl()),
            'routing_mode' => ($req['routing_mode'] ?? 'query') === 'rewrite' ? 'rewrite' : 'query',
            'storage_path' => isset($site['storage_path']) && is_string($site['storage_path']) ? $site['storage_path'] : null,
            'app_secret' => (string) $run['app_secret'],
            'cron_key' => (string) $run['cron_key'],
            'cookie_secure' => str_starts_with(strtolower((string) ($site['base_url'] ?? '')), 'https://'),
        ], (string) $run['generated_at']);
    }

    public function storagePath(): string
    {
        $site = (array) $this->state->get('site', []);
        $custom = $site['storage_path'] ?? null;

        return is_string($custom) && $custom !== '' ? $custom : $this->env->root . '/storage';
    }

    /**
     * @param array<string, mixed> $run
     * @return array<string, mixed>
     */
    private function start(array $run): array
    {
        $dbState = (array) $this->state->get('db', []);
        if (($dbState['mode'] ?? '') === 'overwrite' && empty($run['dropped'])) {
            $dropped = DbInspector::dropPrefixed($this->db()->pdo(), (string) $dbState['prefix']);
            $run['log'][] = Strings::t('run.log.dropped', ['count' => count($dropped)]);
        }
        $run['dropped'] = true;
        $run['log'][] = Strings::t('run.log.start');
        $run['phase'] = 'migrate';

        return $run;
    }

    /**
     * @param array<string, mixed> $run
     * @return array<string, mixed>
     */
    private function migrate(array $run): array
    {
        $runner = new Runner($this->db(), $this->env->root . '/migrations', new CallbackLogger());
        $result = $runner->runNext();
        $status = $runner->status();
        $run['migrations_total'] = count($status);
        $run['migrations_done'] = count(array_filter($status, static fn (array $m): bool => $m['status'] === 'applied'));
        if ($result === null) {
            $run['log'][] = Strings::t('run.log.migrations_done', ['version' => (string) $runner->currentVersion()]);
            $run['phase'] = 'site';

            return $run;
        }
        $run['log'][] = Strings::t('run.log.migration', [
            'name' => $result['version'] . '_' . $result['name'],
            'ms' => $result['duration_ms'],
        ]);

        return $run;
    }

    /**
     * Site settings typed at step 3 (written after the migrations, so they win over the seed),
     * then the administrator account.
     *
     * @param array<string, mixed> $run
     * @return array<string, mixed>
     */
    private function site(array $run): array
    {
        $site = (array) $this->state->get('site', []);
        $admin = (array) $this->state->get('admin', []);
        $db = $this->db();
        $created = $db->transaction(function (Db $db) use ($site, $admin): bool {
            $settings = [
                'site_name' => (string) $site['site_name'],
                'base_url' => (string) $site['base_url'],
                'default_locale' => (string) $site['default_locale'],
                'registration_mode' => (string) $site['registration_mode'],
                'default_quota_bytes' => (int) $site['default_quota_bytes'],
                'max_upload_bytes' => (int) $site['max_upload_bytes'],
                'max_dimension_px' => (int) $site['max_dimension_px'],
                'app_version' => $this->env->appVersion(),
            ];
            foreach ($settings as $key => $value) {
                self::upsertSetting($db, $key, $value);
            }

            return AdminAccount::upsert($db, [
                'email' => (string) $admin['email'],
                'username' => (string) $admin['username'],
                'password_hash' => (string) $admin['password_hash'],
                'locale' => (string) $site['default_locale'],
            ]);
        });
        $run['log'][] = Strings::t('run.log.settings');
        $run['log'][] = Strings::t($created ? 'run.log.admin_created' : 'run.log.admin_updated', [
            'username' => (string) $admin['username'],
        ]);
        $run['phase'] = 'storage';

        return $run;
    }

    /**
     * @param array<string, mixed> $run
     * @return array<string, mixed>
     */
    private function storage(array $run): array
    {
        StorageSetup::create($this->storagePath());
        $run['log'][] = Strings::t('run.log.storage', ['path' => $this->storagePath()]);
        $run['phase'] = 'config';

        return $run;
    }

    /**
     * @param array<string, mixed> $run
     * @return array<string, mixed>
     */
    private function config(array $run): array
    {
        $path = Guard::configPath($this->env->root);
        $content = $this->configContent();
        if (is_file($path)) {
            $existing = ConfigWriter::read($path);
            if ($existing === null || !hash_equals((string) $run['app_secret'], (string) ($existing['app_secret'] ?? ''))) {
                throw new \RuntimeException(Strings::t('run.error.foreign_config'));
            }
            $run['log'][] = Strings::t('run.log.config_found');
            $run['phase'] = 'lock';

            return $run;
        }
        if ($run['phase'] === 'config' && ConfigWriter::writeAtomic($path, $content)) {
            $run['log'][] = Strings::t('run.log.config_written');
            $run['phase'] = 'lock';

            return $run;
        }
        if ($run['phase'] !== 'await_config') {
            $run['log'][] = Strings::t('run.log.config_manual');
        }
        $run['phase'] = 'await_config';

        return $run;
    }

    /**
     * @param array<string, mixed> $run
     * @return array<string, mixed>
     */
    private function lock(array $run): array
    {
        $version = $this->env->appVersion();
        if (!StorageSetup::writeLock($this->storagePath(), $version)) {
            throw new \RuntimeException(Strings::t('run.error.lock'));
        }
        // Custom storage outside the site: also lock the default folder when possible.
        $default = $this->env->root . '/storage';
        if ($this->storagePath() !== $default && is_dir($default) && is_writable($default)) {
            StorageSetup::writeLock($default, $version);
        }
        $run['log'][] = Strings::t('run.log.locked_install');
        $run['phase'] = 'done';
        $run['duration_s'] = round(microtime(true) - (float) ($run['started_at'] ?? microtime(true)), 1);

        return $run;
    }

    private static function upsertSetting(Db $db, string $key, mixed $value): void
    {
        $json = json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $now = gmdate('Y-m-d H:i:s');
        $db->execute(
            'INSERT INTO ' . $db->t('settings') . ' (`key`, `value`, `updated_at`) VALUES (:k, :v, :u)'
            . ' ON DUPLICATE KEY UPDATE `value` = :v2, `updated_at` = :u2',
            ['k' => $key, 'v' => $json, 'u' => $now, 'v2' => $json, 'u2' => $now]
        );
    }

    /**
     * @param array<string, mixed> $run
     * @return array{done:int,total:int}
     */
    private function progress(array $run): array
    {
        $after = ['site' => 0, 'storage' => 1, 'config' => 2, 'await_config' => 2, 'lock' => 3, 'done' => 4];
        $migrations = (int) ($run['migrations_total'] ?? 0);
        $done = (int) ($run['migrations_done'] ?? 0);
        $phase = (string) $run['phase'];
        $total = max(1, $migrations) + 4;
        $current = isset($after[$phase]) ? max(1, $migrations) + $after[$phase] : $done;

        return ['done' => min($total, $current), 'total' => $total];
    }

    /**
     * @return array<string, mixed>
     */
    private function runState(): array
    {
        $run = $this->state->get('run');
        if (!is_array($run) || !in_array($run['phase'] ?? null, self::PHASES, true)) {
            throw new \LogicException('Installation not started.');
        }
        $run['log'] = is_array($run['log'] ?? null) ? array_values($run['log']) : [];

        return $run;
    }

    /**
     * @return array{host:string,port:int,name:string,user:string,pass:string,prefix:string}
     */
    private function dbConfig(): array
    {
        $d = (array) $this->state->get('db', []);

        return [
            'host' => (string) ($d['host'] ?? ''),
            'port' => (int) ($d['port'] ?? 3306),
            'name' => (string) ($d['name'] ?? ''),
            'user' => (string) ($d['user'] ?? ''),
            'pass' => (string) ($d['pass'] ?? ''),
            'prefix' => (string) ($d['prefix'] ?? 'jdr_'),
        ];
    }

    private function db(): Db
    {
        return $this->db ??= new Db($this->dbConfig());
    }

    private static function clean(string $message): string
    {
        return mb_substr(preg_replace('/^SQLSTATE\[[^\]]*\]\s*/', '', $message) ?? $message, 0, 500);
    }
}
