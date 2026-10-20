<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

/**
 * Shown instead of the SPA shell when assets/vite-manifest.json is missing.
 *
 * @var \Closure(string|int|float|null): string $e
 * @var \Closure(string, array<string, string|int|float>=): string $t  escaped
 * @var \Closure(string, array<string, string|int|float>=): string $tr raw
 * @var string $basePath
 */
$pageTitle = $tr('pages.no_build.title');
$pageHeading = $pageTitle;
$pageText = $tr('pages.no_build.text');
$pageHint = $t('pages.no_build.hint', ['command' => 'cd frontend && npm run build']);
require __DIR__ . '/page.php';
