<?php

/**
 * Generates the upload test corpus (projet.md 21): tests/fixtures/uploads/.
 *
 *   php dev/fixtures/make-uploads.php
 *
 * valid_*  : files the image pipeline must accept;
 * trap_*   : files it must refuse (the expected error code is listed in
 *            tests/php/Imaging/ImagePipelineTest.php).
 *
 * Only GD and hand-written binary structures are used (no external tool). Every file stays
 * far below 200 KB; the decompression bomb announces 50 000 x 50 000 px but only carries
 * 32 MiB of zeros, deflated to about 32 KB.
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$dir = dirname(__DIR__, 2) . '/tests/fixtures/uploads';
if (!is_dir($dir) && !mkdir($dir, 0775, true)) {
    fwrite(STDERR, "Cannot create {$dir}\n");
    exit(1);
}
foreach (glob($dir . '/*') ?: [] as $old) {
    if (is_file($old) && basename($old) !== '.gitkeep') {
        unlink($old);
    }
}

// ---------------------------------------------------------------- helpers

function capture(callable $fn): string
{
    ob_start();
    $fn();

    return (string) ob_get_clean();
}

function gdPng(GdImage $image): string
{
    imagesavealpha($image, true);

    return capture(static fn () => imagepng($image, null, 6));
}

function gdJpeg(GdImage $image, int $quality = 85): string
{
    return capture(static fn () => imagejpeg($image, null, $quality));
}

function gdWebp(GdImage $image, int $quality): string
{
    imagesavealpha($image, true);

    return capture(static fn () => imagewebp($image, null, $quality));
}

function gdGif(GdImage $image): string
{
    return capture(static fn () => imagegif($image));
}

function pngChunk(string $type, string $data): string
{
    return pack('N', strlen($data)) . $type . $data . pack('N', crc32($type . $data));
}

/** Inserts chunks right after IHDR (signature 8 bytes + IHDR chunk 25 bytes). */
function pngInsertAfterIhdr(string $png, string $chunks): string
{
    return substr($png, 0, 33) . $chunks . substr($png, 33);
}

/** Concatenated IDAT data of a PNG. */
function pngIdat(string $png): string
{
    $offset = 8;
    $data = '';
    while ($offset < strlen($png)) {
        $len = unpack('N', substr($png, $offset, 4))[1];
        $type = substr($png, $offset + 4, 4);
        if ($type === 'IDAT') {
            $data .= substr($png, $offset + 8, $len);
        }
        $offset += 12 + $len;
    }

    return $data;
}

function ihdr(int $w, int $h, int $depth, int $colorType): string
{
    return pngChunk('IHDR', pack('NNCCCCC', $w, $h, $depth, $colorType, 0, 0, 0));
}

function webpChunk(string $fourcc, string $payload): string
{
    return $fourcc . pack('V', strlen($payload)) . $payload . (strlen($payload) % 2 ? "\0" : '');
}

function riff(string $chunks): string
{
    return 'RIFF' . pack('V', 4 + strlen($chunks)) . 'WEBP' . $chunks;
}

function u24(int $v): string
{
    return chr($v & 0xFF) . chr(($v >> 8) & 0xFF) . chr(($v >> 16) & 0xFF);
}

/** @return array<string, string> fourcc => payload of a simple/extended WebP produced by GD */
function webpChunks(string $webp): array
{
    $chunks = [];
    $offset = 12;
    while ($offset + 8 <= strlen($webp)) {
        $fourcc = substr($webp, $offset, 4);
        $size = unpack('V', substr($webp, $offset + 4, 4))[1];
        $chunks[$fourcc] = substr($webp, $offset + 8, $size);
        $offset += 8 + $size + ($size % 2);
    }

    return $chunks;
}

/**
 * Splits a single-image GIF written by GD into its logical screen info and its image.
 *
 * @return array{w: int, h: int, packed: int, gct: string, transparent: ?int, image: string}
 */
function gifParts(string $gif): array
{
    $packed = ord($gif[10]);
    $gctSize = ($packed & 0x80) ? 3 << (($packed & 7) + 1) : 0;
    $gct = substr($gif, 13, $gctSize);
    $pos = 13 + $gctSize;
    $transparent = null;
    while (true) {
        $b = ord($gif[$pos]);
        if ($b === 0x21) {
            $label = ord($gif[$pos + 1]);
            if ($label === 0xF9 && (ord($gif[$pos + 3]) & 1)) {
                $transparent = ord($gif[$pos + 6]);
            }
            $pos += 2;
            while (($n = ord($gif[$pos])) !== 0) {
                $pos += $n + 1;
            }
            $pos++;
            continue;
        }
        if ($b !== 0x2C) {
            throw new RuntimeException('Unexpected GIF block from GD.');
        }
        $start = $pos;
        $lp = ord($gif[$pos + 9]);
        $pos += 10 + (($lp & 0x80) ? 3 << (($lp & 7) + 1) : 0) + 1;
        while (($n = ord($gif[$pos])) !== 0) {
            $pos += $n + 1;
        }
        $pos++;

        return [
            'w' => unpack('v', substr($gif, 6, 2))[1],
            'h' => unpack('v', substr($gif, 8, 2))[1],
            'packed' => $packed,
            'gct' => $gct,
            'transparent' => $transparent,
            'image' => substr($gif, $start, $pos - $start),
        ];
    }
}

/**
 * Animated GIF from GD frames: each frame's global colour table becomes a local one.
 *
 * @param list<GdImage> $frames
 * @param list<string> $extraBlocks raw extension blocks inserted after the loop extension
 */
function gifAnimation(array $frames, int|array $delayCs, array $extraBlocks = [], bool $loop = true): string
{
    $first = gifParts(gdGif($frames[0]));
    $out = 'GIF89a' . pack('vv', $first['w'], $first['h']) . chr($first['packed'] & 0x70) . "\0\0";
    if ($loop) {
        $out .= "\x21\xFF\x0BNETSCAPE2.0\x03\x01\x00\x00\x00";
    }
    $out .= implode('', $extraBlocks);
    foreach ($frames as $i => $frame) {
        $parts = gifParts(gdGif($frame));
        $delay = is_array($delayCs) ? $delayCs[$i] : $delayCs;
        $flags = 0x08 | ($parts['transparent'] !== null ? 1 : 0); // dispose: restore to background
        $out .= "\x21\xF9\x04" . chr($flags) . pack('v', $delay) . chr($parts['transparent'] ?? 0) . "\0";
        $image = $parts['image'];
        $sizeBits = $parts['packed'] & 0x07;
        $image[9] = chr((ord($image[9]) & 0x40) | 0x80 | $sizeBits);
        $out .= substr($image, 0, 10) . $parts['gct'] . substr($image, 10);
    }

    return $out . "\x3B";
}

function gifComment(string $text): string
{
    return "\x21\xFE" . chr(strlen($text)) . $text . "\0";
}

function gifApplication(string $id11, string $payload): string
{
    return "\x21\xFF\x0B" . $id11 . chr(strlen($payload)) . $payload . "\0";
}

function gradient(int $w, int $h, bool $alpha = false): GdImage
{
    $image = imagecreatetruecolor($w, $h);
    imagealphablending($image, false);
    for ($y = 0; $y < $h; $y++) {
        for ($x = 0; $x < $w; $x++) {
            $a = $alpha ? (int) min(127, (abs($x - $w / 2) + abs($y - $h / 2)) * 127 / ($w / 2)) : 0;
            imagesetpixel($image, $x, $y, imagecolorallocatealpha(
                $image,
                (int) ($x * 255 / max(1, $w - 1)),
                (int) ($y * 255 / max(1, $h - 1)),
                128,
                $a,
            ));
        }
    }

    return $image;
}

function solid(int $w, int $h, int $r, int $g, int $b): GdImage
{
    $image = imagecreatetruecolor($w, $h);
    imagefill($image, 0, 0, imagecolorallocate($image, $r, $g, $b));

    return $image;
}

/** Palette frame with a coloured square moving with $i, transparent background. */
function paletteFrame(int $size, int $i): GdImage
{
    $image = imagecreate($size, $size);
    $bg = imagecolorallocate($image, 255, 255, 255);
    imagecolortransparent($image, $bg);
    $fg = imagecolorallocate($image, (37 * $i) % 256, 80, 200);
    $s = (int) ($size / 4);
    $x = ($i * 3) % ($size - $s);
    imagefilledrectangle($image, $x, $x, $x + $s, $x + $s, $fg);

    return $image;
}

/** APP1 EXIF block (big-endian TIFF) holding only the Orientation tag. */
function exifOrientation(int $orientation): string
{
    $tiff = "MM\x00\x2A" . pack('N', 8) . pack('n', 1)
        . pack('nnNn', 0x0112, 3, 1, $orientation) . "\0\0" . pack('N', 0);
    $payload = "Exif\0\0" . $tiff;

    return "\xFF\xE1" . pack('n', strlen($payload) + 2) . $payload;
}

$files = [];
$put = static function (string $name, string $data) use ($dir, &$files): void {
    file_put_contents($dir . '/' . $name, $data);
    $files[$name] = strlen($data);
};

// ---------------------------------------------------------------- valid files

$opaquePng = gdPng(gradient(64, 48));
$put('valid_png_opaque.png', $opaquePng);
$put('valid_png_transparent.png', gdPng(gradient(64, 64, true)));
$put('valid_png_text_chunk.png', pngInsertAfterIhdr(
    $opaquePng,
    pngChunk('tEXt', "Comment\0JDR-TEST-TEXT-CHUNK") . pngChunk('zTXt', "Software\0\0" . gzcompress('JDR-TEST-ZTXT')),
));

// 80x40 stored landscape: left half red, right half blue; EXIF orientation 6 (rotate 90 CW)
// => displayed 40x80, red on top, blue at the bottom.
$landscape = imagecreatetruecolor(80, 40);
imagefilledrectangle($landscape, 0, 0, 39, 39, imagecolorallocate($landscape, 255, 0, 0));
imagefilledrectangle($landscape, 40, 0, 79, 39, imagecolorallocate($landscape, 0, 0, 255));
$jpeg = gdJpeg($landscape, 95);
$put('valid_jpeg_exif_orientation6.jpg', substr($jpeg, 0, 2) . exifOrientation(6) . substr($jpeg, 2));

$put('valid_webp_lossy.webp', gdWebp(gradient(64, 48), 80));
$put('valid_webp_lossless.webp', gdWebp(gradient(48, 48, true), IMG_WEBP_LOSSLESS));

$frames = [];
for ($i = 0; $i < 10; $i++) {
    $frames[] = paletteFrame(32, $i);
}
$put('valid_gif_animated.gif', gifAnimation($frames, 10, [
    gifComment('JDR-TEST-GIF-COMMENT'),
    gifApplication('XMP DataXMP', 'JDR-TEST-GIF-XMP'),
]));
$put('valid_gif_static.gif', gdGif(paletteFrame(24, 3)));

// Animated WebP written by hand: canvas 48x32, 3 frames.
//  frame 1: lossy with alpha (VP8X-style ALPH + VP8) covering the canvas, 100 ms;
//  frame 2: lossless (VP8L) 16x16 at (8, 8), 100 ms;
//  frame 3: lossless 48x32, duration 0 (played as 100 ms) => total 300 ms.
// Metadata to strip: ICCP, EXIF, "XMP " (+ matching VP8X flags).
$f1 = webpChunks(gdWebp(gradient(48, 32, true), 80));
$f2 = webpChunks(gdWebp(gradient(16, 16), IMG_WEBP_LOSSLESS));
$f3 = webpChunks(gdWebp(gradient(48, 32, true), IMG_WEBP_LOSSLESS));
if (!isset($f1['ALPH'], $f1['VP8 '], $f2['VP8L'], $f3['VP8L'])) {
    fwrite(STDERR, "Unexpected WebP structure from GD.\n");
    exit(1);
}
$anmf = static fn (int $x, int $y, int $w, int $h, int $ms, string $frameChunks): string => webpChunk(
    'ANMF',
    u24(intdiv($x, 2)) . u24(intdiv($y, 2)) . u24($w - 1) . u24($h - 1) . u24($ms) . "\x00" . $frameChunks,
);
$put('valid_webp_animated.webp', riff(
    webpChunk('VP8X', chr(0x20 | 0x10 | 0x08 | 0x04 | 0x02) . "\0\0\0" . u24(47) . u24(31))
    . webpChunk('ICCP', str_repeat("\x00", 16) . 'JDR-TEST-ICC')
    . webpChunk('ANIM', "\0\0\0\0\0\0")
    . $anmf(0, 0, 48, 32, 100, webpChunk('ALPH', $f1['ALPH']) . webpChunk('VP8 ', $f1['VP8 ']))
    . $anmf(8, 8, 16, 16, 100, webpChunk('VP8L', $f2['VP8L']) . webpChunk('JUNK', 'JDR-TEST-JUNK'))
    . $anmf(0, 0, 48, 32, 0, webpChunk('VP8L', $f3['VP8L']))
    . webpChunk('EXIF', 'MM' . "\0\x2A" . 'JDR-TEST-EXIF')
    . webpChunk('XMP ', 'JDR-TEST-XMP-PACKET'),
));

// APNG (acTL / fcTL / fdAT): 2 frames 32x32; treated as a still image (projet.md Q5).
$a = gdPng(gradient(32, 32));
$b = gdPng(solid(32, 32, 10, 200, 30));
$fctl = static fn (int $seq): string => pngChunk('fcTL', pack('NNNNNnnCC', $seq, 32, 32, 0, 0, 10, 100, 0, 0));
$put('valid_apng.png', "\x89PNG\r\n\x1A\n" . substr($a, 8, 25)
    . pngChunk('acTL', pack('NN', 2, 0))
    . $fctl(0) . pngChunk('IDAT', pngIdat($a))
    . $fctl(1) . pngChunk('fdAT', pack('N', 2) . pngIdat($b))
    . pngChunk('IEND', ''));

// ---------------------------------------------------------------- trapped files

$put('trap_polyglot_png_php.png', $opaquePng . "<?php system(\$_GET['c']); ?>\n");
$put('trap_polyglot_png_text_php.png', pngInsertAfterIhdr(
    $opaquePng,
    pngChunk('tEXt', "Comment\0<?= `id` ?>"),
));
$staticGif = gdGif(paletteFrame(24, 1));
$put('trap_polyglot_gif_php.gif', substr($staticGif, 0, -1)
    . gifComment('<?php echo "pwned"; ?>') . "\x3B");
// "EXIF malveillant": JPEG comment (COM) carrying a script.
$script = '<script>alert(document.domain)</script>';
$put('trap_jpeg_comment_script.jpg', substr($jpeg, 0, 2)
    . "\xFF\xFE" . pack('n', 2 + strlen($script)) . $script . substr($jpeg, 2));
$put('trap_svg_renamed.png', '<?xml version="1.0"?>' . "\n"
    . '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" onload="alert(1)"><rect width="10" height="10"/></svg>' . "\n");
$put('trap_html_renamed.png', "<!DOCTYPE html>\n<html><body><script>alert(1)</script></body></html>\n");
$put('trap_php_pure.png', "<?php\nphpinfo();\n");
$put('trap_bmp_renamed.png', capture(static fn () => imagebmp(solid(8, 8, 1, 2, 3))));
$put('trap_tiff_renamed.png', "II\x2A\x00\x08\x00\x00\x00" . str_repeat("\0", 32));
$put('trap_heic_renamed.png', "\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic" . str_repeat("\0", 32));
$put('trap_empty.png', '');

// Decompression bomb: 50 000 x 50 000 px announced, 1-bit grey; the IDAT holds 32 MiB of
// zeros (a fraction of the 312 MB the header implies) so that the file stays small.
$put('trap_png_bomb_50000.png', "\x89PNG\r\n\x1A\n" . ihdr(50000, 50000, 1, 0)
    . pngChunk('IDAT', gzcompress(str_repeat("\0", 32 * 1024 * 1024), 9))
    . pngChunk('IEND', ''));
// 20 000 x 20 000 announced with a tiny (incomplete) IDAT.
$put('trap_png_huge_20000.png', "\x89PNG\r\n\x1A\n" . ihdr(20000, 20000, 8, 2)
    . pngChunk('IDAT', gzcompress(str_repeat("\0", 60001), 9))
    . pngChunk('IEND', ''));
$badCrc = $opaquePng;
$badCrc[29] = chr(ord($badCrc[29]) ^ 0xFF); // last byte of the IHDR CRC
$put('trap_png_bad_crc.png', $badCrc);
$put('trap_png_truncated.png', substr($opaquePng, 0, (int) (strlen($opaquePng) * 0.6)));

$tiny = [];
for ($i = 0; $i < 1000; $i++) {
    $tiny[] = paletteFrame(4, $i);
}
$put('trap_gif_1000_frames.gif', gifAnimation($tiny, 2));
$put('trap_gif_25s.gif', gifAnimation(array_slice($frames, 0, 5), 500));
$animated = gifAnimation($frames, 10);
$put('trap_gif_broken.gif', substr($animated, 0, (int) (strlen($animated) * 0.55)));
$put('trap_gif_bad_block.gif', substr($staticGif, 0, -1) . "\x99\x01\x02\x3B");

$lossy = gdWebp(gradient(64, 48), 80);
$put('trap_webp_bad_riff_size.webp', 'RIFF' . pack('V', strlen($lossy) - 8 + 1000) . substr($lossy, 8));

$noisy = imagecreatetruecolor(64, 48);
mt_srand(42);
for ($y = 0; $y < 48; $y++) {
    for ($x = 0; $x < 64; $x++) {
        imagesetpixel($noisy, $x, $y, mt_rand(0, 0xFFFFFF));
    }
}
$noisyJpeg = gdJpeg($noisy, 90);
$put('trap_jpeg_truncated.jpg', substr($noisyJpeg, 0, (int) (strlen($noisyJpeg) * 0.6)));

ksort($files);
foreach ($files as $name => $size) {
    printf("%-40s %8d bytes\n", $name, $size);
    if ($size > 200 * 1024) {
        fwrite(STDERR, "{$name} exceeds 200 KB\n");
        exit(1);
    }
}
