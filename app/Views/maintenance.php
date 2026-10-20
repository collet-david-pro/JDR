<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

/**
 * Maintenance page (503 + Retry-After).
 *
 * @var \Closure(string|int|float|null): string $e
 * @var \Closure(string, array<string, string|int|float>=): string $t  escaped
 * @var \Closure(string, array<string, string|int|float>=): string $tr raw
 * @var string $message
 * @var string|null $requestId
 * @var string $basePath
 */
$pageTitle = $tr('pages.maintenance.title');
$pageHeading = $pageTitle;
$pageText = $message;
$pageHint = $t('pages.maintenance.hint');
require __DIR__ . '/page.php';
