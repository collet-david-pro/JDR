<?php

/**
 * Prints the MySQL counters used by the load test as one JSON line:
 * {"questions":..,"threads":..,"max_used":..}. Connection from the E2E_DB_* variables.
 */

declare(strict_types=1);

$env = static fn (string $k, string $d): string => ($v = getenv($k)) === false ? $d : $v;
$pdo = new PDO(
    sprintf('mysql:host=%s;port=%d', $env('E2E_DB_HOST', '127.0.0.1'), (int) $env('E2E_DB_PORT', '3306')),
    $env('E2E_DB_USER', 'root'),
    $env('E2E_DB_PASS', ''),
);
$out = [];
foreach (['Questions' => 'questions', 'Threads_connected' => 'threads', 'Max_used_connections' => 'max_used'] as $var => $key) {
    $row = $pdo->query("SHOW GLOBAL STATUS LIKE '$var'")->fetch(PDO::FETCH_NUM);
    $out[$key] = (int) ($row[1] ?? 0);
}
echo json_encode($out), "\n";
