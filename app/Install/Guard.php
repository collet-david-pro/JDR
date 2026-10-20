<?php

declare(strict_types=1);

namespace JDR\Install;

defined('JDR_BOOT') || exit;

/**
 * "Already installed" detection (projet.md 19): config.php or storage/install.lock present.
 */
final class Guard
{
    public static function configPath(string $root): string
    {
        return $root . '/config.php';
    }

    public static function lockPath(string $root): string
    {
        return $root . '/storage/' . StorageSetup::LOCK_FILE;
    }

    public static function isInstalled(string $root): bool
    {
        return is_file(self::configPath($root)) || is_file(self::lockPath($root));
    }

    /**
     * The installation in progress may still go on although config.php exists: only when this
     * browser's wizard wrote it (or asked the user to upload it) and the file carries its app_secret.
     */
    public static function ownsInstallation(string $root, State $state): bool
    {
        if (is_file(self::lockPath($root))) {
            return false;
        }
        $run = $state->get('run');
        $phase = is_array($run) ? ($run['phase'] ?? '') : '';
        $secret = is_array($run) ? (string) ($run['app_secret'] ?? '') : '';
        if (!in_array($phase, ['await_config', 'lock'], true) || $secret === '') {
            return false;
        }
        if ($phase === 'await_config') {
            return true; // the uploaded file is checked (and refused if foreign) by the run itself
        }
        $config = ConfigWriter::read(self::configPath($root));

        return $config === null
            || (is_string($config['app_secret'] ?? null) && hash_equals($secret, $config['app_secret']));
    }
}
