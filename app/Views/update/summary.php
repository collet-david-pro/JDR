<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

/**
 * Summary of the pending package, "Install" button.
 *
 * @var array<string, mixed> $summary
 * @var string   $csrf
 * @var string   $action
 * @var callable $e
 * @var callable $t
 */
$files = (array) ($summary['files'] ?? []);
$unverified = ($summary['authenticity'] ?? '') !== 'verified';
?>
<h2><?= $t('summary.title', ['version' => (string) ($summary['version'] ?? '')]) ?></h2>
<dl class="summary">
<dt><?= $t('summary.current') ?></dt><dd><?= $e((string) ($summary['current'] ?? '')) ?></dd>
<dt><?= $t('summary.new') ?></dt><dd><?= $e((string) ($summary['version'] ?? '')) ?></dd>
<dt><?= $t('summary.authenticity') ?></dt><dd><span class="pill <?= $unverified ? 'warn' : 'ok' ?>"><?= $t($unverified ? 'summary.unverified' : 'summary.verified') ?></span></dd>
<dt><?= $t('summary.files') ?></dt><dd><?= $t('summary.files_value', [
    'added' => (int) ($files['added'] ?? 0), 'changed' => (int) ($files['changed'] ?? 0),
    'removed' => (int) ($files['removed'] ?? 0), 'unchanged' => (int) ($files['unchanged'] ?? 0),
]) ?></dd>
<dt><?= $t('summary.migrations') ?></dt><dd><?= $e(($summary['migrations'] ?? []) === [] ? '—' : implode(', ', (array) $summary['migrations'])) ?></dd>
<dt>SHA-256</dt><dd><code><?= $e((string) ($summary['sha256'] ?? '')) ?></code></dd>
</dl>
<?php foreach ((array) ($summary['warnings'] ?? []) as $warning) : ?>
<div class="notice warn"><?= $e((string) ($warning['message'] ?? '')) ?></div>
<?php endforeach; ?>
<p><?= $t('summary.backup_hint') ?></p>
<form method="post" action="<?= $e($action) ?>">
<input type="hidden" name="_csrf" value="<?= $e($csrf) ?>">
<input type="hidden" name="action" value="start">
<input type="hidden" name="id" value="<?= $e((string) ($summary['id'] ?? '')) ?>">
<?php if ($unverified) : ?>
<label class="check"><input type="checkbox" name="confirm_unverified" value="1" required> <?= $t('summary.confirm_unverified') ?></label>
<?php endif; ?>
<div class="actions"><span></span><button type="submit"><?= $t('summary.install') ?></button></div>
</form>
