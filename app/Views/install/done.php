<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

/**
 * Step 6.
 *
 * @var string $loginUrl
 * @var string $cronUrl
 * @var float $duration
 * @var string $deleted deleted | not_deleted | dev
 * @var callable $e
 * @var callable $t
 */
?>
<h2><?= $t('done.title') ?></h2>
<div class="notice ok" role="status"><?= $t('done.text') ?></div>
<?php if ($duration > 0) : ?><p><?= $t('done.duration', ['s' => number_format($duration, 1, ',', ' ')]) ?></p><?php endif; ?>
<div class="notice <?= $deleted === 'deleted' ? 'ok' : 'warn' ?>"><?= $t('done.' . $deleted) ?></div>
<h3><?= $t('done.cron.title') ?></h3>
<p><?= $t('done.cron.text') ?></p>
<pre><?= $e($cronUrl) ?></pre>
<p class="help"><?= $t('done.cron.note') ?></p>
<p><?= $t('done.backup') ?></p>
<div class="actions"><span></span><a class="btn" href="<?= $e($loginUrl) ?>"><?= $t('btn.login') ?></a></div>
