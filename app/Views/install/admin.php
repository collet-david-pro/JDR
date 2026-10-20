<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

/**
 * Step 4. The strength gauge is a progressive enhancement (nonce script); the server-side policy
 * (Passwords::policyError) is what decides.
 *
 * @var array<string, string> $values
 * @var array<string, string> $errors
 * @var string $token
 * @var string|null $flash
 * @var string $nonce
 * @var callable $e
 * @var callable $t
 * @var callable $tr
 * @var callable $partial
 */
$f = static fn (string $name, string $label, array $o = []): string => $partial('field', $o + [
    'name' => $name, 'label' => $label, 'value' => (string) ($values[$name] ?? ''), 'errors' => $errors,
]);
$labels = [];
for ($i = 0; $i <= 4; $i++) {
    $labels[] = $tr('admin.strength.' . $i);
}
?>
<h2><?= $t('admin.title') ?></h2>
<p class="lead"><?= $t('admin.intro') ?></p>
<?= $partial('flash', ['flash' => $flash]) ?>
<form method="post" action="install.php?step=admin">
<input type="hidden" name="_token" value="<?= $e($token) ?>">
<div class="grid">
<?= $f('email', 'admin.f.email', ['type' => 'email', 'attrs' => ' required maxlength="191" autocomplete="email"']) ?>
<?= $f('username', 'admin.f.username', ['attrs' => ' required minlength="3" maxlength="40" autocomplete="username"', 'help' => $tr('admin.f.username_help')]) ?>
<?= $f('password', 'admin.f.password', ['type' => 'password', 'value' => '', 'attrs' => ' required minlength="10" maxlength="256" autocomplete="new-password"', 'help' => $tr('admin.f.password_help')]) ?>
<?= $f('password_confirm', 'admin.f.password_confirm', ['type' => 'password', 'value' => '', 'attrs' => ' required minlength="10" maxlength="256" autocomplete="new-password"']) ?>
<div class="full" id="strength" hidden>
<div class="help"><?= $t('admin.strength') ?> : <span id="strength-label"></span></div>
<div class="gauge"><span id="strength-bar"></span></div>
</div>
</div>
<div class="actions">
<a class="btn secondary" href="install.php?step=site"><?= $t('btn.back') ?></a>
<button type="submit"><?= $t('btn.continue') ?></button>
</div>
</form>
<script nonce="<?= $e($nonce) ?>">
(function () {
  var input = document.getElementById('f-password');
  var box = document.getElementById('strength');
  var bar = document.getElementById('strength-bar');
  var label = document.getElementById('strength-label');
  var labels = <?= json_encode($labels, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_UNICODE) ?>;
  var colors = ['var(--err)', 'var(--err)', 'var(--warn)', 'var(--ok)', 'var(--ok)'];
  if (!input || !box) return;
  box.hidden = false;
  function score(p) {
    if (p.length < 10) return p.length < 6 ? 0 : 1;
    var classes = 0;
    [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].forEach(function (r) { if (r.test(p)) classes++; });
    var s = 1 + (p.length >= 14 ? 1 : 0) + (p.length >= 20 ? 1 : 0) + (classes >= 3 ? 1 : 0);
    if (/^(.)\1+$/.test(p) || /^(?:0123456789|1234567890|azertyuiop|qwertyuiop)/i.test(p)) s = 1;
    return Math.min(4, s);
  }
  function update() {
    var s = score(input.value);
    bar.style.width = input.value === '' ? '0' : ((s + 1) * 20) + '%';
    bar.style.background = colors[s];
    label.textContent = input.value === '' ? '' : labels[s];
  }
  input.addEventListener('input', update);
  update();
})();
</script>
