<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

/**
 * Step 3.
 *
 * @var array<string, string> $values
 * @var array<string, string> $errors
 * @var string $routing
 * @var string $defaultStorage
 * @var string|null $suggestion
 * @var string $uploadLimit
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
$sel = static fn (string $name, string $value): string => ($values[$name] ?? '') === $value ? ' selected' : '';
$custom = ($values['storage'] ?? 'default') === 'custom';
?>
<h2><?= $t('site.title') ?></h2>
<p class="lead"><?= $t('site.intro') ?></p>
<?= $partial('flash', ['flash' => $flash]) ?>
<form method="post" action="install.php?step=site">
<input type="hidden" name="_token" value="<?= $e($token) ?>">
<div class="grid">
<?= $f('site_name', 'site.f.site_name', ['attrs' => ' required maxlength="80"']) ?>
<div class="<?= isset($errors['registration_mode']) ? 'invalid' : '' ?>">
<label for="f-registration_mode"><?= $t('site.f.registration') ?></label>
<select id="f-registration_mode" name="registration_mode">
<?php foreach (['open', 'closed', 'invite'] as $mode) : ?>
<option value="<?= $e($mode) ?>"<?= $sel('registration_mode', $mode) ?>><?= $t('site.reg.' . $mode) ?></option>
<?php endforeach; ?>
</select>
</div>
<?= $f('base_url', 'site.f.base_url', ['type' => 'url', 'class' => 'full', 'attrs' => ' required maxlength="255"', 'help' => $tr('site.f.base_url_help') . ' ' . $tr('site.routing', ['mode' => $tr('site.routing.' . $routing)])]) ?>
<div>
<label for="f-default_locale"><?= $t('site.f.locale') ?></label>
<select id="f-default_locale" name="default_locale"><option value="fr" selected><?= $t('site.locale.fr') ?></option></select>
</div>
<?= $f('default_quota_mb', 'site.f.quota', ['type' => 'number', 'attrs' => ' min="1" max="1048576" required', 'help' => $tr('site.f.quota_help')]) ?>
<?= $f('max_upload_mb', 'site.f.max_upload', ['type' => 'number', 'attrs' => ' min="1" max="512" required', 'help' => $tr('site.f.max_upload_help', ['limit' => $uploadLimit])]) ?>
<?= $f('max_dimension_px', 'site.f.max_dimension', ['type' => 'number', 'attrs' => ' min="256" max="16384" required', 'help' => $tr('site.f.max_dimension_help')]) ?>
<fieldset class="full<?= isset($errors['storage_custom']) ? ' invalid' : '' ?>">
<legend><?= $t('site.f.storage') ?></legend>
<label class="check"><input type="radio" name="storage" value="default"<?= $custom ? '' : ' checked' ?>> <?= $t('site.storage.default', ['path' => $defaultStorage]) ?></label>
<label class="check"><input type="radio" name="storage" value="custom"<?= $custom ? ' checked' : '' ?>> <?= $t('site.storage.custom') ?></label>
<input type="text" id="f-storage_custom" name="storage_custom" value="<?= $e($values['storage_custom'] ?? '') ?>" placeholder="<?= $e($suggestion ?? '/home/compte/jdr-storage') ?>" aria-label="<?= $t('site.storage.custom') ?>">
<?php if ($suggestion !== null) : ?><div class="help"><?= $t('site.storage.suggest', ['path' => $suggestion]) ?></div><?php endif; ?>
<?php if (isset($errors['storage_custom'])) : ?><div class="field-error"><?= $t('err.' . $errors['storage_custom']) ?></div><?php endif; ?>
</fieldset>
</div>
<div class="actions">
<a class="btn secondary" href="install.php?step=database"><?= $t('btn.back') ?></a>
<button type="submit"><?= $t('btn.continue') ?></button>
</div>
</form>
