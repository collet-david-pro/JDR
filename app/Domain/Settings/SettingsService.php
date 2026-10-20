<?php

declare(strict_types=1);

namespace JDR\Domain\Settings;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\ValidationException;
use JDR\Domain\Audit\AuditLog;
use JDR\Domain\Support\Validator;
use JDR\Domain\Users\User;
use JDR\Mail\Message;
use JDR\Mail\SmtpClient;

/**
 * Admin view and validated update of the site settings.
 * The SMTP password is write-only: stored encrypted (SecretBox), exposed as password_set.
 */
final class SettingsService
{
    /** Integer settings: [min, max]. */
    private const INTS = [
        'default_quota_bytes' => [0, PHP_INT_MAX],
        'max_upload_bytes' => [1024, 2147483647],
        'max_dimension_px' => [64, 32768],
        'max_total_pixels' => [4096, 1073741824],
        'max_frames' => [1, 10000],
        'max_animation_ms' => [100, 600000],
        'events_retention_hours' => [1, 720],
        'versions_retention' => [1, 1000],
        'trash_days' => [1, 3650],
        'session_idle_hours' => [1, 720],
    ];
    private const BOOLS = ['use_db_sessions', 'maintenance'];
    private const LOCALES = ['fr'];

    public function __construct(
        private Settings $settings,
        private AuditLog $audit,
        private ?SecretBox $secretBox = null,
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function view(): array
    {
        $all = $this->settings->all();
        $smtp = $this->settings->smtp();
        $out = [];
        foreach (array_keys(Settings::DEFAULTS) as $key) {
            if ($key === 'smtp') {
                $out['smtp'] = [
                    'host' => $smtp['host'],
                    'port' => $smtp['port'],
                    'encryption' => $smtp['encryption'],
                    'username' => $smtp['username'],
                    'password_set' => $smtp['password_enc'] !== '',
                    'from_email' => $smtp['from_email'],
                    'from_name' => $smtp['from_name'],
                ];
                continue;
            }
            $default = Settings::DEFAULTS[$key];
            $out[$key] = match (true) {
                is_bool($default) => $this->settings->bool($key),
                is_int($default) => $this->settings->int($key),
                default => is_string($all[$key]) ? $all[$key] : $default,
            };
        }
        $out['registration_mode'] = $this->settings->registrationMode();

        return $out;
    }

    /**
     * @param array<string, mixed> $input partial settings
     * @return array<string, mixed> the new view
     * @throws ValidationException
     */
    public function update(array $input, User $admin, string $ip): array
    {
        $v = new Validator($input);
        $values = [];
        foreach ($input as $key => $_) {
            $key = (string) $key;
            if ($key === 'smtp' || $key === 'site_name' || $key === 'base_url' || $key === 'default_locale'
                || $key === 'registration_mode' || isset(self::INTS[$key]) || in_array($key, self::BOOLS, true)) {
                continue;
            }
            $v->error($key, 'invalid');
        }
        if ($v->has('site_name')) {
            $values['site_name'] = $v->string('site_name', true, 1, 100);
        }
        if ($v->has('base_url')) {
            $url = $v->string('base_url', false, 0, 255);
            if ($url !== null && (filter_var($url, FILTER_VALIDATE_URL) === false
                || preg_match('#^https?://#i', $url) !== 1)) {
                $v->error('base_url', 'invalid');
            }
            $values['base_url'] = $url === null ? '' : rtrim($url, '/');
        }
        if ($v->has('default_locale')) {
            $values['default_locale'] = $v->in('default_locale', self::LOCALES);
        }
        if ($v->has('registration_mode')) {
            $values['registration_mode'] = $v->in('registration_mode', Settings::REGISTRATION_MODES);
        }
        foreach (self::INTS as $key => [$min, $max]) {
            if ($v->has($key)) {
                $values[$key] = $v->int($key, true, $min, $max);
            }
        }
        foreach (self::BOOLS as $key) {
            if ($v->has($key)) {
                $values[$key] = $v->bool($key);
            }
        }
        $smtpChanged = [];
        if ($v->has('smtp')) {
            $smtpInput = $input['smtp'];
            if (!is_array($smtpInput)) {
                $v->error('smtp', 'invalid');
            } else {
                [$smtp, $smtpChanged] = $this->smtp($smtpInput, $v);
                $values['smtp'] = $smtp;
            }
        }
        $v->validate();
        $this->settings->setMany($values);
        $changed = array_keys($values);
        if ($smtpChanged !== []) {
            $changed = array_values(array_diff($changed, ['smtp']));
            foreach ($smtpChanged as $key) {
                $changed[] = 'smtp.' . $key;
            }
        }
        $this->audit->record($admin->id, 'settings.update', 'settings', null, ['keys' => $changed], $ip);

        return $this->view();
    }

    /**
     * @param array<array-key, mixed> $input
     * @return array{0: array<string, mixed>, 1: list<string>}
     */
    private function smtp(array $input, Validator $parent): array
    {
        $smtp = $this->settings->smtp();
        $v = new Validator($input);
        $changed = [];
        $allowed = ['host', 'port', 'encryption', 'username', 'password', 'from_email', 'from_name'];
        foreach (array_keys($input) as $key) {
            if (!in_array((string) $key, $allowed, true)) {
                $parent->error('smtp.' . $key, 'invalid');
            }
        }
        if ($v->has('host')) {
            $host = $v->string('host', false, 0, 191);
            if ($host !== null && preg_match('/^[A-Za-z0-9.\-\[\]:]+$/', $host) !== 1) {
                $v->error('host', 'invalid');
            }
            $smtp['host'] = $host ?? '';
            $changed[] = 'host';
        }
        if ($v->has('port')) {
            $smtp['port'] = $v->int('port', true, 1, 65535) ?? $smtp['port'];
            $changed[] = 'port';
        }
        if ($v->has('encryption')) {
            $smtp['encryption'] = $v->in('encryption', SmtpClient::ENCRYPTIONS) ?? $smtp['encryption'];
            $changed[] = 'encryption';
        }
        if ($v->has('username')) {
            $smtp['username'] = $v->string('username', false, 0, 191, false) ?? '';
            $changed[] = 'username';
        }
        if ($v->has('password')) {
            $password = $input['password'];
            if ($password === null || $password === '') {
                $smtp['password_enc'] = '';
            } elseif (!is_string($password) || strlen($password) > 1024) {
                $v->error('password', 'invalid');
            } elseif ($this->secretBox === null) {
                $v->error('password', 'invalid');
            } else {
                $smtp['password_enc'] = $this->secretBox->encrypt($password);
            }
            $changed[] = 'password';
        }
        if ($v->has('from_email')) {
            $from = $v->email('from_email', false);
            if ($from !== null && !Message::validAddress($from)) {
                $v->error('from_email', 'invalid');
            }
            $smtp['from_email'] = $from ?? '';
            $changed[] = 'from_email';
        }
        if ($v->has('from_name')) {
            $name = $v->string('from_name', false, 0, 100);
            $smtp['from_name'] = $name === null ? '' : str_replace(["\r", "\n"], ' ', $name);
            $changed[] = 'from_name';
        }
        foreach ($v->errors() as $field => $code) {
            $parent->error('smtp.' . $field, $code);
        }

        return [$smtp, $changed];
    }
}
