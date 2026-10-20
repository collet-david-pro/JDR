<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

/**
 * SPA shell. The boot JSON is already escaped for embedding (JSON_HEX_*).
 *
 * @var \Closure(string|int|float|null): string $e
 * @var \Closure(string, array<string, string|int|float>=): string $t
 * @var string $nonce
 * @var string $script
 * @var list<string> $styles
 * @var list<string> $preloads
 * @var string $bootJson
 */
?>
<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title><?= $t('app.name') ?></title>
<?php foreach ($styles as $href) : ?>
<link rel="stylesheet" href="<?= $e($href) ?>">
<?php endforeach; ?>
<?php foreach ($preloads as $href) : ?>
<link rel="modulepreload" href="<?= $e($href) ?>">
<?php endforeach; ?>
<script id="jdr-boot" type="application/json"><?= $bootJson ?></script>
<script type="module" nonce="<?= $e($nonce) ?>" src="<?= $e($script) ?>"></script>
</head>
<body>
<div id="app"></div>
<noscript><?= $t('pages.noscript') ?></noscript>
</body>
</html>
