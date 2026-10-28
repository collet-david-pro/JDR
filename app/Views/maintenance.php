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
 * @var string|null $updateUrl update.php when the database is behind the code
 */
$pageTitle = $tr('pages.maintenance.title');
$pageHeading = $pageTitle;
$pageText = $message;
$pageHint = $t('pages.maintenance.hint');
if (isset($updateUrl) && is_string($updateUrl)) {
    $updateLabel = $tr('pages.maintenance.update_link');
    if ($updateLabel === 'pages.maintenance.update_link') {
        $updateLabel = 'Administrateur : terminer la mise à jour'; // key pending in i18n/_pending/maj-a.json
    }
    $pageHint .= '<br><a href="' . $e($updateUrl) . '">' . $e($updateLabel) . '</a>';
}
require __DIR__ . '/page.php';
