<?php

declare(strict_types=1);

namespace JDR\Domain\Users;

defined('JDR_BOOT') || exit;

/**
 * Extension point for personal data owned by other domains (games, assets, sessions... from P2 on):
 * included in the export (GET /me/export) and handled on account deletion (projet.md 11.1:
 * games transferred to a co-GM or soft-deleted, personal assets deleted).
 * Register implementations in UserDataExtensions (App::create()).
 */
interface UserDataExtension
{
    /**
     * Section name in the export document (e.g. "games").
     */
    public function name(): string;

    /**
     * Personal data of the user for the export (JSON-serializable).
     */
    public function export(User $user): mixed;

    /**
     * Called inside the deletion transaction, before the account is anonymized.
     */
    public function deleteUserData(User $user): void;
}
