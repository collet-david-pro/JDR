<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

/**
 * Step 5, running. Without JS: <noscript> meta refresh (in <head>, see Installer) drives one unit of work per request.
 * With JS: the same URL is fetched as JSON in a loop, without reloading the page.
 *
 * @var array{phase:string,log:list<string>,error:?string,progress:array{done:int,total:int}} $result
 * @var string $doUrl
 * @var bool $auto
 * @var string|null $config
 * @var string $nonce
 * @var callable $e
 * @var callable $t
 * @var callable $tr
 */
$error = $result['error'];
$await = $result['phase'] === 'await_config';
$p = $result['progress'];
$percent = $p['total'] > 0 ? (int) round(100 * $p['done'] / $p['total']) : 0;
?>
<h2><?= $t('run.title') ?></h2>
<p class="lead"><?= $t('run.intro') ?></p>
<div id="run-error"<?= $error === null ? ' hidden' : '' ?>>
<div class="notice error" role="alert"><span id="run-error-text"><?= $e($error ?? '') ?></span><br><?= $t('run.error.help') ?></div>
</div>
<label for="run-bar"><?= $t('run.progress') ?></label>
<div class="bar" id="run-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="<?= $percent ?>"><span style="width:<?= $percent ?>%"></span></div>
<h3><?= $t('run.journal') ?></h3>
<ul class="log" id="run-log" aria-live="polite">
<?php foreach ($result['log'] as $line) : ?>
<li><?= $e($line) ?></li>
<?php endforeach; ?>
</ul>
<?php if ($await && $config !== null) : ?>
<h3><?= $t('run.await.title') ?></h3>
<p><?= $t('run.await.text') ?></p>
<div class="notice warn"><?= $t('run.await.warning') ?></div>
<textarea class="code" rows="24" readonly aria-label="config.php"><?= $e($config) ?></textarea>
<?php endif; ?>
<div class="actions">
<noscript><?= $t('run.noscript') ?></noscript><span></span>
<a class="btn<?= $error === null && !$await ? ' secondary' : '' ?>" id="run-retry" href="<?= $e($doUrl) ?>"><?= $error !== null ? $t('btn.retry') : ($await ? $t('btn.check_config') : $t('run.continue')) ?></a>
</div>
<?php if ($auto) : ?>
<script nonce="<?= $e($nonce) ?>">
(function () {
  var url = <?= json_encode($doUrl . '&format=json', JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_SLASHES) ?>;
  var log = document.getElementById('run-log');
  var bar = document.querySelector('#run-bar span');
  var barBox = document.getElementById('run-bar');
  var errBox = document.getElementById('run-error');
  var errText = document.getElementById('run-error-text');
  var retry = document.getElementById('run-retry');
  var shown = log.children.length;
  var failures = 0;
  retry.hidden = true;
  function render(r) {
    for (var i = shown; i < r.log.length; i++) {
      var li = document.createElement('li');
      li.textContent = r.log[i];
      log.appendChild(li);
    }
    shown = r.log.length;
    log.scrollTop = log.scrollHeight;
    var pct = r.progress.total > 0 ? Math.round(100 * r.progress.done / r.progress.total) : 0;
    bar.style.width = pct + '%';
    barBox.setAttribute('aria-valuenow', String(pct));
  }
  function step() {
    fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (res) { return res.json(); })
      .then(function (r) {
        failures = 0;
        if (!r.log) { throw new Error(r.error || 'error'); }
        render(r);
        if (r.error) {
          errText.textContent = r.error;
          errBox.hidden = false;
          retry.hidden = false;
          retry.classList.remove('secondary');
          retry.textContent = <?= json_encode($tr('btn.retry'), JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_UNICODE) ?>;
          return;
        }
        if (r.phase === 'done') { window.location.href = r.done_url; return; }
        if (r.phase === 'await_config') { window.location.href = 'install.php?step=run'; return; }
        window.setTimeout(step, 50);
      })
      .catch(function () {
        failures++;
        if (failures < 4) { window.setTimeout(step, 1000 * failures); return; }
        retry.hidden = false; // plain link: the page-reload path still works
      });
  }
  step();
})();
</script>
<?php endif; ?>
