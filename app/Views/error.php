<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

/**
 * Error page (non-API requests).
 *
 * @var \Closure(string|int|float|null): string $e
 * @var \Closure(string, array<string, string|int|float>=): string $t  escaped
 * @var \Closure(string, array<string, string|int|float>=): string $tr raw
 * @var int $status
 * @var string $code
 * @var string $message
 * @var string|null $requestId
 * @var string $basePath
 */
$pageTitle = (string) $status;
$pageHeading = match ($status) {
    404 => $tr('pages.not_found.title'),
    403 => $tr('pages.forbidden.title'),
    default => $tr('pages.error.title'),
};
$pageText = $message;
$pageHint = '<a href="' . $e($basePath . '/') . '">' . $t('common.home') . '</a>';
require __DIR__ . '/page.php';
