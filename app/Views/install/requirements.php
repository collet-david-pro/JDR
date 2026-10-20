<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

/**
 * Step 1.
 *
 * @var list<\JDR\Install\Check> $checks
 * @var string $worst
 * @var string $token
 * @var string|null $flash
 * @var callable $t
 * @var callable $e
 * @var callable $partial
 */
$notice = ['ok' => 'req.all_ok', 'warn' => 'req.warn_ok', 'error' => 'req.blocked'][$worst];
?>
<h2><?= $t('req.title') ?></h2>
<p class="lead"><?= $t('req.intro') ?></p>
<?= $partial('flash', ['flash' => $flash]) ?>
<div class="notice <?= $e($worst) ?>" role="status"><?= $t($notice) ?></div>
<?= $partial('checks', ['checks' => $checks]) ?>
<form method="post" action="install.php?step=requirements">
<input type="hidden" name="_token" value="<?= $e($token) ?>">
<div class="actions">
<a class="btn secondary" href="install.php?step=requirements"><?= $t('btn.recheck') ?></a>
<button type="submit"<?= $worst === 'error' ? ' disabled' : '' ?>><?= $t('btn.continue') ?></button>
</div>
</form>
