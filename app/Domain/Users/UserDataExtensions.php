<?php

declare(strict_types=1);

namespace JDR\Domain\Users;

defined('JDR_BOOT') || exit;

/**
 * Registry of UserDataExtension (empty in P1).
 */
final class UserDataExtensions
{
    /** @var list<UserDataExtension> */
    private array $extensions = [];

    public function add(UserDataExtension $extension): void
    {
        $this->extensions[] = $extension;
    }

    /**
     * @return list<UserDataExtension>
     */
    public function all(): array
    {
        return $this->extensions;
    }
}
