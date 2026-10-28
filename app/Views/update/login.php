<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

/**
 * Login form (administrators only).
 *
 * @var string      $csrf
 * @var string      $action
 * @var string      $identifier
 * @var string|null $error
 * @var callable    $e
 * @var callable    $t
 */
?>
<h2><?= $t('login.title') ?></h2>
<p class="lead"><?= $t('login.intro') ?></p>
<?php if ($error !== null) : ?>
<div class="notice error" role="alert"><?= $e($error) ?></div>
<?php endif; ?>
<form method="post" action="<?= $e($action) ?>">
<input type="hidden" name="_csrf" value="<?= $e($csrf) ?>">
<input type="hidden" name="action" value="login">
<div class="grid">
<div class="full"><label for="identifier"><?= $t('login.identifier') ?></label>
<input type="text" id="identifier" name="identifier" value="<?= $e($identifier) ?>" autocomplete="username" required autofocus></div>
<div class="full"><label for="password"><?= $t('login.password') ?></label>
<input type="password" id="password" name="password" autocomplete="current-password" required></div>
</div>
<div class="actions"><span></span><button type="submit"><?= $t('login.submit') ?></button></div>
</form>
