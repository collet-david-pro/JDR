<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

/**
 * Nothing pending: either files already sent by FTP (disk mode) or nothing to do.
 *
 * @var array{from:?string,to:string,db_behind:bool}|null $disk
 * @var string   $current
 * @var string   $csrf
 * @var string   $action
 * @var string   $home
 * @var callable $e
 * @var callable $t
 */
?>
<?php if ($disk === null) : ?>
<h2><?= $t('home.idle.title') ?></h2>
<p class="lead"><?= $t('home.idle.text', ['version' => $current]) ?></p>
<div class="actions"><span></span><a class="btn" href="<?= $e($home) ?>"><?= $t('btn.site') ?></a></div>
<?php else : ?>
<h2><?= $t('home.disk.title') ?></h2>
<p class="lead"><?= $t('home.disk.text', ['from' => $disk['from'] ?? '?', 'to' => $disk['to']]) ?></p>
<?php if ($disk['db_behind']) : ?>
<div class="notice warn"><?= $t('home.disk.db_behind') ?></div>
<?php endif; ?>
<form method="post" action="<?= $e($action) ?>">
<input type="hidden" name="_csrf" value="<?= $e($csrf) ?>">
<input type="hidden" name="action" value="start_disk">
<div class="actions"><span></span><button type="submit"><?= $t('home.disk.start') ?></button></div>
</form>
<?php endif; ?>
