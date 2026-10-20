<?php

declare(strict_types=1);

namespace JDR\Domain\Users;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Core\Errors\ValidationException;

/**
 * user_prefs: white-listed keys only, values validated before writing (JSON columns are opaque).
 */
final class UserPrefs
{
    public const KEYS = ['theme_scheme', 'theme_style', 'editor', 'shortcuts'];
    private const ENUMS = [
        'theme_scheme' => ['light', 'dark', 'auto'],
        'theme_style' => ['modern', 'fantasy', 'scifi'],
    ];
    private const MAX_JSON_BYTES = 16384;

    public function __construct(private Db $db)
    {
    }

    /**
     * @return array<string, mixed>
     */
    public function all(int $userId): array
    {
        $prefs = [];
        $rows = $this->db->fetchAll(
            'SELECT `key`, `value` FROM ' . $this->db->t('user_prefs') . ' WHERE `user_id` = ? ORDER BY `key`',
            [$userId],
        );
        foreach ($rows as $row) {
            $prefs[(string) $row['key']] = json_decode((string) $row['value'], true);
        }

        return $prefs;
    }

    /**
     * Sets (or, with null, removes) a preference.
     *
     * @throws ValidationException unknown key or invalid value
     */
    public function put(int $userId, string $key, mixed $value): void
    {
        if (!in_array($key, self::KEYS, true)) {
            throw new ValidationException('', ['key' => 'invalid']);
        }
        if ($value === null) {
            $this->db->execute(
                'DELETE FROM ' . $this->db->t('user_prefs') . ' WHERE `user_id` = ? AND `key` = ?',
                [$userId, $key],
            );

            return;
        }
        if (isset(self::ENUMS[$key])) {
            if (!is_string($value) || !in_array($value, self::ENUMS[$key], true)) {
                throw new ValidationException('', ['value' => 'invalid']);
            }
        } elseif (!is_array($value) || ($value !== [] && array_is_list($value))) {
            throw new ValidationException('', ['value' => 'invalid']);
        }
        $json = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        if (strlen($json) > self::MAX_JSON_BYTES) {
            throw new ValidationException('', ['value' => 'too_long']);
        }
        $this->db->execute(
            'INSERT INTO ' . $this->db->t('user_prefs') . ' (`user_id`, `key`, `value`) VALUES (?, ?, ?) '
            . 'ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
            [$userId, $key, $json === '[]' ? '{}' : $json],
        );
    }

    public function deleteAll(int $userId): void
    {
        $this->db->execute('DELETE FROM ' . $this->db->t('user_prefs') . ' WHERE `user_id` = ?', [$userId]);
    }
}
