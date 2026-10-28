<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

/**
 * Installer layout: self-contained HTML/CSS (no build, no external resource), light by default,
 * dark when the system asks for it.
 *
 * @var string      $content
 * @var string|null $step
 * @var string      $title
 * @var string      $head
 * @var string      $nonce
 * @var callable    $e
 * @var callable    $t
 */
$steps = \JDR\Install\Page::STEPS;
$current = $step === null ? -1 : (int) array_search($step, $steps, true);
?><!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<title><?= $e($title) ?></title>
<?= $head ?>
<?php require __DIR__ . '/styles.php'; ?>
</head>
<body>
<div class="wrap">
<header class="top"><h1><?= $t('app.title') ?></h1><span><?= $t('app.subtitle') ?></span></header>
<?php if ($current >= 0) : ?>
<ol class="steps" aria-label="<?= $t('step.counter', ['n' => $current + 1]) ?>">
<?php foreach ($steps as $i => $s) : ?>
<li class="<?= $i < $current ? 'done' : ($i === $current ? 'current' : '') ?>"<?= $i === $current ? ' aria-current="step"' : '' ?>><b><?= $i + 1 ?></b><?= $t('step.' . $s) ?></li>
<?php endforeach; ?>
</ol>
<?php endif; ?>
<main class="card">
<?= $content ?>
</main>
<footer>JDR <?= $e(defined('APP_VERSION') ? APP_VERSION : '') ?></footer>
</div>
</body>
</html>
