<?php

declare(strict_types=1);

namespace JDR\Install;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;

/**
 * Creates (or, when the installation is resumed, updates) the administrator account.
 * Only the password hash ever reaches this class.
 */
final class AdminAccount
{
    /**
     * @param array{email:string,username:string,password_hash:string,locale:string} $a
     * @return bool true when created, false when an existing account was updated
     */
    public static function upsert(Db $db, array $a): bool
    {
        if (!str_starts_with($a['password_hash'], '$')) {
            throw new \InvalidArgumentException('A password hash is expected.');
        }
        $now = gmdate('Y-m-d H:i:s');
        $users = $db->t('users');
        $byEmail = $db->fetchOne('SELECT id FROM ' . $users . ' WHERE email = ?', [$a['email']]);
        $byName = $db->fetchOne('SELECT id FROM ' . $users . ' WHERE username = ?', [$a['username']]);
        if ($byName !== null && ($byEmail === null || (string) $byName['id'] !== (string) $byEmail['id'])) {
            throw new \RuntimeException(Strings::t('run.error.username_taken', ['username' => $a['username']]));
        }
        if ($byEmail !== null) {
            $db->execute(
                'UPDATE ' . $users . " SET username = ?, password_hash = ?, role = 'admin', status = 'active',"
                . ' deleted_at = NULL, updated_at = ? WHERE id = ?',
                [$a['username'], $a['password_hash'], $now, (int) $byEmail['id']]
            );

            return false;
        }
        $db->execute(
            'INSERT INTO ' . $users . ' (email, username, password_hash, role, status, locale, email_verified_at,'
            . " created_at, updated_at) VALUES (?, ?, ?, 'admin', 'active', ?, ?, ?, ?)",
            [$a['email'], $a['username'], $a['password_hash'], $a['locale'], $now, $now, $now]
        );
        $id = (int) $db->lastInsertId();
        $db->execute(
            'INSERT INTO ' . $db->t('audit_log') . " (user_id, action, entity, entity_id, data, ip, created_at)"
            . " VALUES (?, 'system.install', 'user', ?, ?, NULL, ?)",
            [$id, $id, json_encode(['version' => defined('APP_VERSION') ? \APP_VERSION : null], JSON_THROW_ON_ERROR), $now]
        );

        return true;
    }
}
