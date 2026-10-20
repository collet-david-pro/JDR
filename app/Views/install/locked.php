<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

/**
 * Already installed.
 *
 * @var string $home
 * @var callable $e
 * @var callable $t
 */
?>
<h2><?= $t('locked.title') ?></h2>
<p class="lead"><?= $t('locked.text') ?></p>
<div class="notice warn"><?= $t('locked.reinstall') ?></div>
<div class="actions"><span></span><a class="btn" href="<?= $e($home) ?>"><?= $t('locked.home') ?></a></div>
