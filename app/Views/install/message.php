<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

/**
 * @var string $message
 * @var callable $e
 * @var callable $t
 */
?>
<h2><?= $t('fatal.title') ?></h2>
<div class="notice error" role="alert"><?= $e($message) ?></div>
<div class="actions"><a class="btn secondary" href="install.php"><?= $t('btn.back') ?></a></div>
