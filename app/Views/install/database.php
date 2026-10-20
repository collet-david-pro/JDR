<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

/**
 * Step 2.
 *
 * @var array<string, mixed> $values
 * @var array<string, string> $errors
 * @var list<\JDR\Install\Check> $checks
 * @var array<string, mixed>|null $pending
 * @var bool $hasSavedPassword
 * @var string $token
 * @var string|null $flash
 * @var callable $e
 * @var callable $t
 * @var callable $tr
 * @var callable $partial
 */
$f = static fn (string $name, string $label, array $o = []): string => $partial('field', $o + [
    'name' => $name, 'label' => $label, 'value' => (string) ($values[$name] ?? ''), 'errors' => $errors,
]);
$existing = is_array($pending) ? (array) ($pending['existing'] ?? []) : [];
$inspectionOk = is_array($pending) && ($pending['ok'] ?? false) === true;
?>
<h2><?= $t('db.title') ?></h2>
<p class="lead"><?= $t('db.intro') ?></p>
<?= $partial('flash', ['flash' => $flash]) ?>
<?php if ($checks !== []) : ?>
<?= $partial('checks', ['checks' => $checks]) ?>
<?php endif; ?>

<?php if ($inspectionOk && $existing !== []) : ?>
<form method="post" action="install.php?step=database">
<input type="hidden" name="_token" value="<?= $e($token) ?>">
<input type="hidden" name="action" value="choice">
<div class="notice warn" role="alert">
<strong><?= $t('db.existing.title', ['prefix' => (string) $pending['prefix']]) ?></strong><br>
<?= $t('db.existing.count', ['count' => count($existing), 'list' => implode(', ', array_slice($existing, 0, 12)) . (count($existing) > 12 ? '…' : '')]) ?>
</div>
<?php if (isset($errors['choice'])) : ?><div class="notice error" role="alert"><?= $t('err.' . $errors['choice']) ?></div><?php endif; ?>
<fieldset>
<legend><?= $t('db.existing.choose') ?></legend>
<label class="check"><input type="radio" name="choice" value="cancel" checked> <?= $t('db.existing.cancel') ?></label>
<?php if (($pending['resumable'] ?? false) === true) : ?>
<label class="check"><input type="radio" name="choice" value="resume"> <?= $t('db.existing.resume') ?></label>
<?php endif; ?>
<label class="check"><input type="radio" name="choice" value="overwrite"> <?= $t('db.existing.overwrite') ?></label>
<div style="margin:8px 0 0 26px">
<label class="check"><input type="checkbox" name="confirm1" value="1"> <?= $t('db.existing.confirm1') ?></label>
<label for="f-confirm2" style="font-weight:400"><?= $t('db.existing.confirm2') ?> (<code><?= $e((string) $pending['prefix']) ?></code>)</label>
<input type="text" id="f-confirm2" name="confirm2" value="" autocomplete="off" style="max-width:240px">
</div>
</fieldset>
<div class="actions"><span></span><button type="submit"><?= $t('btn.confirm') ?></button></div>
</form>
<h3><?= $t('db.title') ?></h3>
<?php endif; ?>

<form method="post" action="install.php?step=database" autocomplete="off">
<input type="hidden" name="_token" value="<?= $e($token) ?>">
<input type="hidden" name="action" value="test">
<div class="grid">
<?= $f('host', 'db.f.host', ['attrs' => ' required maxlength="255"']) ?>
<?= $f('port', 'db.f.port', ['type' => 'number', 'attrs' => ' min="1" max="65535" required']) ?>
<?= $f('name', 'db.f.name', ['attrs' => ' required maxlength="64"']) ?>
<?= $f('user', 'db.f.user', ['attrs' => ' required maxlength="80"']) ?>
<?= $f('pass', 'db.f.pass', ['type' => 'password', 'value' => '', 'attrs' => ' maxlength="256" autocomplete="new-password"', 'help' => $hasSavedPassword ? $tr('db.f.pass_keep') : null]) ?>
<?= $f('prefix', 'db.f.prefix', ['attrs' => ' required maxlength="16" pattern="[a-z][a-z0-9_]{0,15}"', 'help' => $tr('db.f.prefix_help')]) ?>
<div class="full"><label class="check"><input type="checkbox" name="create_db" value="1"<?= !empty($values['create_db']) ? ' checked' : '' ?>> <?= $t('db.f.create_db') ?></label></div>
</div>
<div class="actions">
<a class="btn secondary" href="install.php?step=requirements"><?= $t('btn.back') ?></a>
<button type="submit"><?= $t('btn.test') ?></button>
</div>
</form>
