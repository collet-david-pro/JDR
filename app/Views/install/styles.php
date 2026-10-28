<?php

declare(strict_types=1);

defined('JDR_BOOT') || exit;

/*
 * Stylesheet shared by the installer and update.php layouts (self-contained, light/dark).
 */
?>
<style>
:root{--bg:#f6f7f9;--card:#fff;--text:#1d2330;--muted:#5d6676;--line:#e2e5ea;--accent:#3557d6;--accent-ink:#fff;
--ok:#1f8a4c;--ok-bg:#e7f6ed;--warn:#a46200;--warn-bg:#fff4e0;--err:#c22f2f;--err-bg:#fdecec;--code:#f0f2f5;
--radius:10px;--shadow:0 1px 2px rgba(16,24,40,.06),0 4px 16px rgba(16,24,40,.06)}
@media (prefers-color-scheme:dark){:root{--bg:#12151b;--card:#1b2029;--text:#e6e9ef;--muted:#9aa3b2;--line:#2c3340;
--accent:#7d97ff;--accent-ink:#0d1220;--ok:#5cd28f;--ok-bg:#15301f;--warn:#f0b357;--warn-bg:#33270f;--err:#ff7b7b;
--err-bg:#3a1717;--code:#11151c;--shadow:none}}
*{box-sizing:border-box}
[hidden]{display:none!important}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
.wrap{max-width:860px;margin:0 auto;padding:24px 16px 48px}
header.top{display:flex;align-items:baseline;gap:12px;margin-bottom:20px}
header.top h1{font-size:1.35rem;margin:0}
header.top span{color:var(--muted);font-size:.95rem}
ol.steps{list-style:none;display:flex;flex-wrap:wrap;gap:6px;padding:0;margin:0 0 20px}
ol.steps li{flex:1 1 120px;padding:8px 10px;border-radius:8px;background:var(--card);border:1px solid var(--line);color:var(--muted);font-size:.88rem}
ol.steps li b{display:inline-block;width:1.5em;height:1.5em;line-height:1.5em;text-align:center;border-radius:50%;background:var(--line);color:var(--text);margin-right:6px;font-size:.8rem}
ol.steps li.done{color:var(--text)} ol.steps li.done b{background:var(--ok);color:#fff}
ol.steps li.current{border-color:var(--accent);color:var(--text);font-weight:600} ol.steps li.current b{background:var(--accent);color:var(--accent-ink)}
main.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);padding:24px}
h2{font-size:1.25rem;margin:0 0 6px} h3{font-size:1.05rem;margin:22px 0 8px}
p.lead{color:var(--muted);margin:0 0 18px}
table.checks{width:100%;border-collapse:collapse;margin:8px 0 16px;font-size:.95rem}
table.checks td{padding:8px 6px;border-top:1px solid var(--line);vertical-align:top}
table.checks td.v{white-space:nowrap;color:var(--muted);text-align:right}
table.checks small{display:block;color:var(--muted)}
.pill{display:inline-block;min-width:76px;text-align:center;padding:2px 8px;border-radius:99px;font-size:.78rem;font-weight:600}
.pill.ok{background:var(--ok-bg);color:var(--ok)} .pill.warn{background:var(--warn-bg);color:var(--warn)} .pill.error{background:var(--err-bg);color:var(--err)}
.notice{padding:12px 14px;border-radius:8px;margin:0 0 16px;border:1px solid transparent}
.notice.ok{background:var(--ok-bg);color:var(--ok)} .notice.warn{background:var(--warn-bg);color:var(--warn)} .notice.error{background:var(--err-bg);color:var(--err)}
form .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px 18px}
form .full{grid-column:1/-1}
@media (max-width:640px){form .grid{grid-template-columns:1fr}}
label{display:block;font-weight:600;font-size:.92rem;margin-bottom:4px}
.help{color:var(--muted);font-size:.85rem;margin-top:3px}
.field-error{color:var(--err);font-size:.85rem;margin-top:3px}
input[type=text],input[type=email],input[type=password],input[type=number],input[type=url],select,textarea{width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text);font:inherit}
input:focus,select:focus,textarea:focus,button:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.invalid input,.invalid select{border-color:var(--err)}
.check{display:flex;gap:8px;align-items:flex-start;font-weight:400}
.check input{margin-top:5px}
.actions{display:flex;gap:10px;justify-content:space-between;align-items:center;margin-top:22px;flex-wrap:wrap}
button,.btn{display:inline-block;padding:10px 18px;border-radius:8px;border:1px solid var(--accent);background:var(--accent);color:var(--accent-ink);font:inherit;font-weight:600;cursor:pointer;text-decoration:none}
button[disabled]{opacity:.45;cursor:not-allowed}
.btn.secondary,button.secondary{background:transparent;color:var(--accent)}
button.danger{background:var(--err);border-color:var(--err);color:#fff}
fieldset{border:1px solid var(--line);border-radius:8px;padding:12px 14px;margin:0}
legend{font-weight:600;padding:0 6px}
pre,textarea.code{font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--code);border-radius:8px;padding:12px;overflow:auto}
ul.log{list-style:none;margin:0;padding:12px;background:var(--code);border-radius:8px;max-height:320px;overflow:auto;font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
ul.log li::before{content:"› ";color:var(--muted)}
.bar{height:10px;border-radius:99px;background:var(--line);overflow:hidden;margin:6px 0 16px}
.bar span{display:block;height:100%;background:var(--accent);transition:width .3s}
.gauge{height:6px;border-radius:99px;background:var(--line);overflow:hidden;margin-top:6px}
.gauge span{display:block;height:100%;width:0;background:var(--err);transition:width .2s}
dl.summary{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;margin:0 0 12px}
dl.summary dt{color:var(--muted)} dl.summary dd{margin:0}
code{background:var(--code);padding:1px 5px;border-radius:5px;font-size:.9em}
footer{color:var(--muted);font-size:.82rem;text-align:center;margin-top:18px}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style>
