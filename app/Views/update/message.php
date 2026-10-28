<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

/**
 * @var string $level ok|warn|error
 * @var string $message
 * @var string $home
 * @var callable $e
 * @var callable $t
 */
?>
<div class="notice <?= $e($level) ?>" role="<?= $level === 'error' ? 'alert' : 'status' ?>"><?= $e($message) ?></div>
<div class="actions"><span></span><a class="btn secondary" href="<?= $e($home) ?>"><?= $t('btn.back') ?></a></div>
