<?php
declare(strict_types=1);

/**
 * Lists classes, interfaces, traits, enums and public methods (constructors aside) under app/
 * that lack a docblock.
 * Usage: php dev/docblocks.php [--json] [path]   (exit code 1 when something is missing)
 * No dependency: relies on the tokenizer extension only.
 */

$root = realpath(__DIR__ . '/../app');
$args = array_values(array_filter(array_slice($argv, 1), static fn($a) => $a !== '--json'));
$asJson = in_array('--json', $argv, true);
$target = $args[0] ?? $root;
$files = [];
$it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($target, FilesystemIterator::SKIP_DOTS));
foreach ($it as $f) {
    if ($f->isFile() && $f->getExtension() === 'php') {
        $files[] = $f->getPathname();
    }
}
sort($files);

$missing = [];
foreach ($files as $file) {
    $tokens = token_get_all((string) file_get_contents($file));
    $n = count($tokens);
    $doc = false;       // a docblock directly precedes the current declaration
    $mods = [];         // modifiers collected since the last declaration boundary
    $depth = 0;         // brace depth
    $classDepths = [];  // brace depths at which a class-like body opens
    $pendingClass = false;
    $curClass = '';
    for ($i = 0; $i < $n; $i++) {
        $t = $tokens[$i];
        if (!is_array($t)) {
            if ($t === '{') {
                $depth++;
                if ($pendingClass) {
                    $classDepths[] = $depth;
                    $pendingClass = false;
                }
            } elseif ($t === '}') {
                if ($classDepths && end($classDepths) === $depth) {
                    array_pop($classDepths);
                }
                $depth--;
            }
            if ($t === ';' || $t === '{' || $t === '}') {
                $mods = [];
                $doc = false;
            }
            continue;
        }
        [$id, $text, $line] = $t;
        if ($id === T_WHITESPACE || $id === T_COMMENT) {
            continue;
        }
        if ($id === T_DOC_COMMENT) {
            $doc = true;
            continue;
        }
        if ($id === T_ATTRIBUTE) {
            // skip the attribute group, keep the docblock state
            $lvl = 1;
            while (++$i < $n && $lvl > 0) {
                if ($tokens[$i] === '[' || (is_array($tokens[$i]) && $tokens[$i][0] === T_ATTRIBUTE)) {
                    $lvl++;
                } elseif ($tokens[$i] === ']') {
                    $lvl--;
                }
            }
            $i--;
            continue;
        }
        if (in_array($id, [T_PUBLIC, T_PROTECTED, T_PRIVATE, T_STATIC, T_ABSTRACT, T_FINAL, T_READONLY], true)) {
            $mods[] = $id;
            continue;
        }
        if (in_array($id, [T_CLASS, T_INTERFACE, T_TRAIT, T_ENUM], true)) {
            $prev = null;
            for ($k = $i - 1; $k >= 0; $k--) {
                if (is_array($tokens[$k]) && $tokens[$k][0] === T_WHITESPACE) { continue; }
                $prev = $tokens[$k];
                break;
            }
            if (is_array($prev) && $prev[0] === T_DOUBLE_COLON) { continue; } // Foo::class
            if (is_array($prev) && $prev[0] === T_NEW) { continue; }
            $name = '';
            for ($k = $i + 1; $k < $n; $k++) {
                if (is_array($tokens[$k]) && $tokens[$k][0] === T_STRING) { $name = $tokens[$k][1]; break; }
                if (is_array($tokens[$k]) && $tokens[$k][0] === T_WHITESPACE) { continue; }
                break;
            }
            if ($name === '') { continue; }
            $pendingClass = true;
            $curClass = $name;
            if (!$doc) {
                $missing[] = [$file, $line, $text . ' ' . $name];
            }
            $mods = [];
            $doc = false;
            continue;
        }
        if ($id === T_FUNCTION && $classDepths && $depth === end($classDepths)) {
            $name = '';
            for ($k = $i + 1; $k < $n; $k++) {
                if (is_array($tokens[$k]) && $tokens[$k][0] === T_STRING) { $name = $tokens[$k][1]; break; }
                if (is_array($tokens[$k]) && $tokens[$k][0] === T_WHITESPACE) { continue; }
                if ($tokens[$k] === '&') { continue; }
                break;
            }
            $public = !in_array(T_PRIVATE, $mods, true) && !in_array(T_PROTECTED, $mods, true);
            // Constructors are skipped: their promoted parameters say what they take.
            if ($name !== '' && $name !== '__construct' && $public && !$doc) {
                $missing[] = [$file, $line, $curClass . '::' . $name . '()'];
            }
            $mods = [];
            $doc = false;
            continue;
        }
        if ($id === T_FUNCTION && !$classDepths) {
            // top-level function (not a closure)
            $name = '';
            for ($k = $i + 1; $k < $n; $k++) {
                if (is_array($tokens[$k]) && $tokens[$k][0] === T_STRING) { $name = $tokens[$k][1]; break; }
                if (is_array($tokens[$k]) && $tokens[$k][0] === T_WHITESPACE) { continue; }
                break;
            }
            if ($name !== '' && !$doc && $depth === 0) {
                $missing[] = [$file, $line, $name . '()'];
            }
            $doc = false;
            continue;
        }
        // any other token: a doc comment only applies to the next declaration
        if (!in_array($id, [T_OPEN_TAG, T_DECLARE, T_NAMESPACE, T_USE, T_STRING, T_NAME_QUALIFIED], true)) {
            // keep $doc across modifiers only
        }
    }
}

if ($asJson) {
    echo json_encode(array_map(static fn($m) => ['file' => $m[0], 'line' => $m[1], 'what' => $m[2]], $missing)), "\n";
    exit($missing ? 1 : 0);
}

$base = dirname($root) . '/';
foreach ($missing as [$f, $l, $what]) {
    echo str_replace($base, '', $f) . ':' . $l . '  ' . $what . "\n";
}
echo count($missing) . " declaration(s) without docblock\n";
exit($missing ? 1 : 0);
