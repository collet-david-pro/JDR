<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

/**
 * Progress of a run. Without JS: "Continue" posts one slice of work per request.
 * With JS: the same form is posted in a loop (Accept: application/json) and the page is reloaded at the end.
 *
 * @var array<string, mixed> $run  RunState::view()
 * @var string   $csrf
 * @var string   $action
 * @var string   $home
 * @var string   $nonce
 * @var callable $e
 * @var callable $t
 * @var callable $tr
 */
$state = (string) $run['state'];
$progress = $run['progress'];
$active = in_array($state, ['ready', 'running', 'rolling_back', 'restoring'], true);
$hidden = static fn (string $action) => '<input type="hidden" name="_csrf" value="' . $e($csrf) . '">'
    . '<input type="hidden" name="action" value="' . $e($action) . '">'
    . '<input type="hidden" name="id" value="' . $e((string) $run['id']) . '">';
?>
<h2><?= $t('run.title', ['from' => (string) ($run['from'] ?? '?'), 'to' => (string) $run['to']]) ?></h2>
<p class="lead" id="run-state"><?= $t('state.' . $state) ?></p>
<?php if ($state === 'done') : ?>
<div class="notice ok" role="status"><?= $t('run.done', ['to' => (string) $run['to']]) ?></div>
<?php elseif ($state === 'restored') : ?>
<div class="notice ok" role="status"><?= $t($run['mode'] === 'package' ? 'run.restored' : 'run.restored_disk') ?></div>
<?php endif; ?>
<div id="run-error"<?= $run['error'] === null ? ' hidden' : '' ?>><div class="notice error" role="alert" id="run-error-text"><?= $e((string) ($run['error'] ?? '')) ?></div></div>
<?php if ($run['details'] !== []) : ?>
<pre><?= $e(implode("\n", $run['details'])) ?></pre>
<?php endif; ?>
<label for="run-bar"><?= $t('run.progress') ?> — <span id="run-label"><?= $e($progress['label']) ?></span> <span id="run-detail"><?= $e($progress['detail']) ?></span></label>
<div class="bar" id="run-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="<?= (int) $progress['percent'] ?>"><span style="width:<?= (int) $progress['percent'] ?>%"></span></div>
<h3><?= $t('run.journal') ?></h3>
<ul class="log" id="run-log" aria-live="polite">
<?php foreach ($run['log'] as $line) : ?>
<li><?= $e($line) ?></li>
<?php endforeach; ?>
</ul>
<?php if ($active) : ?>
<form method="post" action="<?= $e($action) ?>" id="step-form">
<?= $hidden('step') ?>
<div class="actions"><span><?= $t('run.keep_open') ?></span><button type="submit" id="step-button"><?= $t('btn.continue') ?></button></div>
</form>
<script nonce="<?= $e($nonce) ?>">
(function () {
  var form = document.getElementById('step-form');
  var button = document.getElementById('step-button');
  var log = document.getElementById('run-log');
  var bar = document.querySelector('#run-bar span');
  var failures = 0;
  button.hidden = true;
  function render(run) {
    log.textContent = '';
    run.log.forEach(function (line) { var li = document.createElement('li'); li.textContent = line; log.appendChild(li); });
    log.scrollTop = log.scrollHeight;
    bar.style.width = run.progress.percent + '%';
    document.getElementById('run-bar').setAttribute('aria-valuenow', String(run.progress.percent));
    document.getElementById('run-label').textContent = run.progress.label;
    document.getElementById('run-detail').textContent = run.progress.detail;
  }
  function step() {
    // getAttribute: the form has a field named "action", which shadows form.action.
    fetch(form.getAttribute('action'), {
      method: 'POST', credentials: 'same-origin', body: new URLSearchParams(new FormData(form)),
      headers: { Accept: 'application/json' }
    }).then(function (res) { return res.json(); }).then(function (data) {
      if (!data.ok) { throw new Error('error'); }
      failures = 0;
      render(data.run);
      if (['ready', 'running', 'rolling_back', 'restoring'].indexOf(data.run.state) === -1) { window.location.reload(); return; }
      window.setTimeout(step, data.busy ? 1500 : 50);
    }).catch(function () {
      failures++;
      if (failures < 5) { window.setTimeout(step, 1000 * failures); return; }
      button.hidden = false; // the plain form still works
    });
  }
  step();
})();
</script>
<?php elseif ($state === 'failed_migration') : ?>
<p><?= $t('run.failed_migration.help') ?></p>
<div class="actions">
<form method="post" action="<?= $e($action) ?>"><?= $hidden('restore') ?><button type="submit" class="danger"><?= $t('btn.restore') ?></button></form>
<form method="post" action="<?= $e($action) ?>"><?= $hidden('retry') ?><button type="submit"><?= $t('btn.retry') ?></button></form>
</div>
<?php else : ?>
<div class="actions"><span></span><a class="btn" href="<?= $e($home) ?>"><?= $t('btn.site') ?></a></div>
<?php endif; ?>
