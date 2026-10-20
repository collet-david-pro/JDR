<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

/**
 * @var string|null $flash string key
 * @var callable $t
 */
if (isset($flash) && is_string($flash)) : ?>
<div class="notice error" role="alert"><?= $t($flash) ?></div>
<?php endif;
