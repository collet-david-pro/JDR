<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

/**
 * Standalone page layout (no front-end build needed).
 *
 * @var \Closure(string|int|float|null): string $e
 * @var \Closure(string, array<string, string|int|float>=): string $t
 * @var string $pageTitle
 * @var string $pageHeading
 * @var string $pageText
 * @var string|null $pageHint
 * @var string|null $requestId
 * @var string $basePath
 */
$pageHint ??= null;
$requestId ??= null;
?>
<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="light dark">
<title><?= $e($pageTitle) ?> · <?= $t('app.name') ?></title>
<style>
:root{--bg:#f7f7f8;--fg:#1d1d20;--muted:#5d5d66;--card:#fff;--line:#e2e2e6;--accent:#3b5bdb}
@media (prefers-color-scheme:dark){:root{--bg:#141417;--fg:#ececf1;--muted:#a0a0ab;--card:#1d1d22;--line:#2e2e35;--accent:#7b93f5}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;
background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:34rem;width:100%;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:28px}
h1{margin:0 0 .5rem;font-size:1.35rem}
p{margin:.5rem 0;color:var(--muted)}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em}
a{color:var(--accent)}
.rid{margin-top:1.25rem;font-size:.85rem}
</style>
</head>
<body>
<main>
<h1><?= $e($pageHeading) ?></h1>
<p><?= $e($pageText) ?></p>
<?php if ($pageHint !== null) : ?>
<p><?= $pageHint ?></p>
<?php endif; ?>
<?php if ($requestId !== null) : ?>
<p class="rid"><?= $t('pages.error.request_id', ['id' => $requestId]) ?></p>
<?php endif; ?>
</main>
</body>
</html>
