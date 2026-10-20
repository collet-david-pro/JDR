<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

/**
 * Check table (green / orange / red).
 *
 * @var list<\JDR\Install\Check> $checks
 * @var callable $e
 * @var callable $t
 */
?>
<table class="checks">
<?php foreach ($checks as $c) : ?>
<tr>
<td><span class="pill <?= $e($c->status) ?>"><?= $t('status.' . $c->status) ?></span></td>
<td><?= $t($c->label) ?><?php if ($c->hint !== null) : ?><small><?= $t($c->hint, $c->params) ?></small><?php endif; ?></td>
<td class="v"><?= $e($c->value) ?></td>
</tr>
<?php endforeach; ?>
</table>
