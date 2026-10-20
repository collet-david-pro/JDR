<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

/**
 * One labelled input.
 *
 * @var string $name
 * @var string $label string key
 * @var string $value
 * @var string $type
 * @var array<string, string> $errors
 * @var string|null $help raw help text (already translated)
 * @var string $attrs extra raw attributes (trusted, written by the views)
 * @var string $class
 * @var callable $e
 * @var callable $t
 */
$error = $errors[$name] ?? null;
$id = 'f-' . $name;
?>
<div class="<?= $e(($class ?? '') . ($error !== null ? ' invalid' : '')) ?>">
<label for="<?= $e($id) ?>"><?= $t($label) ?></label>
<input type="<?= $e($type ?? 'text') ?>" id="<?= $e($id) ?>" name="<?= $e($name) ?>" value="<?= $e($value ?? '') ?>"<?= $attrs ?? '' ?><?= $error !== null ? ' aria-invalid="true" aria-describedby="' . $e($id) . '-err"' : '' ?>>
<?php if (!empty($help)) : ?><div class="help"><?= $e($help) ?></div><?php endif; ?>
<?php if ($error !== null) : ?><div class="field-error" id="<?= $e($id) ?>-err"><?= $t('err.' . $error) ?></div><?php endif; ?>
</div>
