<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

/**
 * Step 5, before starting: summary and confirmation.
 *
 * @var array<string, mixed> $db
 * @var array<string, mixed> $site
 * @var array<string, mixed> $admin
 * @var string $routing
 * @var string $storage
 * @var string $token
 * @var callable $e
 * @var callable $t
 * @var callable $tr
 */
$mode = (string) ($db['mode'] ?? 'fresh');
?>
<h2><?= $t('run.summary') ?></h2>
<p class="lead"><?= $t('run.intro') ?></p>
<?php if ($mode === 'overwrite') : ?>
<div class="notice error" role="alert"><?= $t('run.summary.mode.overwrite', ['prefix' => (string) $db['prefix']]) ?></div>
<?php elseif ($mode === 'resume') : ?>
<div class="notice warn"><?= $t('run.summary.mode.resume') ?></div>
<?php else : ?>
<div class="notice ok"><?= $t('run.summary.mode.fresh') ?></div>
<?php endif; ?>
<dl class="summary">
<dt><?= $t('step.database') ?></dt><dd><?= $t('run.summary.db', ['name' => (string) $db['name'], 'host' => $db['host'] . ':' . $db['port'], 'prefix' => (string) $db['prefix']]) ?></dd>
<dt><?= $t('step.site') ?></dt><dd><?= $t('run.summary.site', ['name' => (string) $site['site_name'], 'url' => (string) $site['base_url']]) ?></dd>
<dt><?= $t('site.f.storage') ?></dt><dd><code><?= $e($storage) ?></code></dd>
<dt><?= $t('req.routing') ?></dt><dd><?= $t('site.routing.' . $routing) ?></dd>
<dt><?= $t('step.admin') ?></dt><dd><?= $t('run.summary.admin', ['username' => (string) $admin['username'], 'email' => (string) $admin['email']]) ?></dd>
</dl>
<form method="post" action="install.php?step=run">
<input type="hidden" name="_token" value="<?= $e($token) ?>">
<input type="hidden" name="action" value="start">
<div class="actions">
<a class="btn secondary" href="install.php?step=admin"><?= $t('btn.back') ?></a>
<button type="submit"<?= $mode === 'overwrite' ? ' class="danger"' : '' ?>><?= $t('btn.start') ?></button>
</div>
</form>
