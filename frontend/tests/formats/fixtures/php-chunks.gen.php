<?php
// Regenerate: php tests/formats/fixtures/php-chunks.gen.php > tests/formats/fixtures/php-chunks.json (then prettier).
// Builds 12.2 raw chunks and compresses them with gzdeflate (as the server does).
function chunk(int $layer, callable $cell): string {
  $raw = "JC" . chr(1) . chr($layer) . "\0\0\0\0";
  for ($i = 0; $i < 1024; $i++) { [$idx, $v, $f] = $cell($i); $raw .= pack('vCC', $idx, $v, $f); }
  return $raw;
}
$seed = 12345;
$rand = function () use (&$seed) { $seed = ($seed * 1103515245 + 12345) & 0x7fffffff; return $seed; };
$vectors = [];
$add = function ($name, $layer, $raw, $level) use (&$vectors) {
  $vectors[] = ['name' => $name, 'layer' => $layer, 'level' => $level,
    'raw' => base64_encode($raw), 'compressed' => base64_encode(gzdeflate($raw, $level))];
};
$add('ground-pattern', 0, chunk(0, fn($i) => [($i % 32 < 16) ? 1 : 2, 0, 0]), 6);
$add('terrain-sparse', 1, chunk(1, fn($i) => $i % 97 === 0 ? [3, $i % 4, $i % 16] : [0, 0, 0]), 6);
$add('decor-random', 2, chunk(2, function ($i) use ($rand) { $r = $rand(); return [1 + $r % 300, ($r >> 9) % 256, ($r >> 17) % 16]; }), 6);
$add('ground-random-l9', 0, chunk(0, function ($i) use ($rand) { $r = $rand(); return [1 + $r % 7, ($r >> 9) % 3, 0]; }), 9);
$add('ground-full-l1', 0, chunk(0, fn($i) => [65535, 255, 255]), 1);
echo json_encode(['generator' => 'php ' . PHP_VERSION . ' gzdeflate($raw, level)', 'vectors' => $vectors], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), "\n";
