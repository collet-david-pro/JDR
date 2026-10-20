<?php

declare(strict_types=1);

namespace JDR\Domain\Settings;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Db;

/**
 * Typed access to the settings table (projet.md 7.2). Every known key has a default, identical
 * to the seed migration 0002_seed.php: get() returns it when the row is missing.
 * Rows are read once per request.
 */
final class Settings
{
    public const DEFAULTS = [
        'site_name' => 'JDR',
        'base_url' => '',
        'default_locale' => 'fr',
        'registration_mode' => 'open',
        'default_quota_bytes' => 524288000,
        'max_upload_bytes' => 10485760,
        'max_dimension_px' => 4096,
        'max_total_pixels' => 16777216,
        'max_frames' => 300,
        'max_animation_ms' => 20000,
        'events_retention_hours' => 24,
        'versions_retention' => 30,
        'trash_days' => 30,
        'session_idle_hours' => 12,
        'use_db_sessions' => false,
        'maintenance' => false,
        'smtp' => self::SMTP_DEFAULTS,
    ];

    /** password_enc: password encrypted with app_secret (SecretBox), never returned by the API. */
    public const SMTP_DEFAULTS = [
        'host' => '',
        'port' => 587,
        'encryption' => 'starttls',
        'username' => '',
        'password_enc' => '',
        'from_email' => '',
        'from_name' => 'JDR',
    ];

    public const REGISTRATION_MODES = ['open', 'closed', 'invite'];

    /** @var array<string, mixed>|null */
    private ?array $values = null;

    public function __construct(private Db $db, private Clock $clock)
    {
    }

    public function get(string $key): mixed
    {
        $values = $this->load();
        if (array_key_exists($key, $values)) {
            return $values[$key];
        }

        return self::DEFAULTS[$key] ?? null;
    }

    public function int(string $key): int
    {
        $value = $this->get($key);
        if (is_int($value)) {
            return $value;
        }
        if (is_float($value) || (is_string($value) && is_numeric($value))) {
            return (int) $value;
        }
        $default = self::DEFAULTS[$key] ?? 0;

        return is_int($default) ? $default : 0;
    }

    public function bool(string $key): bool
    {
        $value = $this->get($key);

        return $value === true || $value === 1 || $value === '1';
    }

    public function string(string $key): string
    {
        $value = $this->get($key);
        if (is_string($value)) {
            return $value;
        }
        $default = self::DEFAULTS[$key] ?? '';

        return is_string($default) ? $default : '';
    }

    public function registrationMode(): string
    {
        $mode = $this->string('registration_mode');

        return in_array($mode, self::REGISTRATION_MODES, true) ? $mode : 'open';
    }

    /**
     * SMTP settings merged with the defaults.
     *
     * @return array{host: string, port: int, encryption: string, username: string, password_enc: string,
     *     from_email: string, from_name: string}
     */
    public function smtp(): array
    {
        $stored = $this->get('smtp');
        $stored = is_array($stored) ? $stored : [];
        $smtp = self::SMTP_DEFAULTS;
        foreach (self::SMTP_DEFAULTS as $key => $default) {
            $value = $stored[$key] ?? null;
            if (is_int($default) && is_numeric($value)) {
                $smtp[$key] = (int) $value;
            } elseif (is_string($default) && is_string($value)) {
                $smtp[$key] = $value;
            }
        }

        return $smtp;
    }

    public function smtpEnabled(): bool
    {
        $smtp = $this->smtp();

        return $smtp['host'] !== '' && $smtp['from_email'] !== '';
    }

    /**
     * Every known key with its current value.
     *
     * @return array<string, mixed>
     */
    public function all(): array
    {
        $out = [];
        foreach (array_keys(self::DEFAULTS) as $key) {
            $out[$key] = $key === 'smtp' ? $this->smtp() : $this->get($key);
        }

        return $out;
    }

    public function set(string $key, mixed $value): void
    {
        $this->setMany([$key => $value]);
    }

    /**
     * @param array<string, mixed> $values
     */
    public function setMany(array $values): void
    {
        if ($values === []) {
            return;
        }
        $now = $this->clock->sql();
        $this->db->transaction(function (Db $db) use ($values, $now): void {
            foreach ($values as $key => $value) {
                $db->execute(
                    'INSERT INTO ' . $db->t('settings') . ' (`key`, `value`, `updated_at`) VALUES (?, ?, ?) '
                    . 'ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), `updated_at` = VALUES(`updated_at`)',
                    [$key, json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR), $now],
                );
            }
        });
        $this->values = null;
    }

    /**
     * Forgets the cached rows (next read hits the database).
     */
    public function refresh(): void
    {
        $this->values = null;
    }

    /**
     * @return array<string, mixed>
     */
    private function load(): array
    {
        if ($this->values === null) {
            $this->values = [];
            foreach ($this->db->fetchAll('SELECT `key`, `value` FROM ' . $this->db->t('settings')) as $row) {
                $decoded = json_decode((string) $row['value'], true);
                if (json_last_error() === JSON_ERROR_NONE) {
                    $this->values[(string) $row['key']] = $decoded;
                }
            }
        }

        return $this->values;
    }
}
