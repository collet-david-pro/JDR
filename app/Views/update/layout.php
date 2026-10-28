<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

/**
 * update.php layout (same stylesheet as the installer).
 *
 * @var string   $content
 * @var string   $title
 * @var callable $e
 * @var callable $t
 */
?><!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<title><?= $e($title) ?></title>
<?php require dirname(__DIR__) . '/install/styles.php'; ?>
</head>
<body>
<div class="wrap">
<header class="top"><h1><?= $t('page.title') ?></h1><span><?= $t('page.subtitle') ?></span></header>
<main class="card">
<?= $content ?>
</main>
<footer>JDR <?= $e(defined('APP_VERSION') ? APP_VERSION : '') ?></footer>
</div>
</body>
</html>
