<?php

declare(strict_types=1);

namespace JDR\Http;

defined('JDR_BOOT') || exit;

use JDR\Core\Config;
use JDR\Core\Response;
use JDR\Core\View;

/**
 * SPA shell (app/Views/shell.php): injects the Vite entry with the CSP nonce and the boot data
 * read by frontend/src/lib/boot.ts. Without a build, renders the "front-end not built" page.
 */
final class Shell
{
    public const ENTRY = 'src/main.ts';
    public const MANIFEST = 'assets/vite-manifest.json';

    private const JSON_FLAGS = JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT
        | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR;

    public function __construct(private string $publicRoot, private View $view)
    {
    }

    /**
     * $build: entry file of the front build (see build()); the SPA compares it with GET /version to
     * reload itself after a site update.
     *
     * @return array{version: string, build: string, api_base: string, routing_mode: string, base_path: string, csrf: string|null, maintenance: bool, feedback_url: string}
     */
    public static function bootData(string $basePath, string $routingMode, ?string $csrf, bool $maintenance = false, string $feedbackUrl = '', string $build = ''): array
    {
        return [
            'version' => \APP_VERSION,
            'build' => $build,
            'api_base' => Config::apiBase($basePath, $routingMode),
            'routing_mode' => $routingMode,
            'base_path' => $basePath,
            'csrf' => $csrf,
            'maintenance' => $maintenance,
            'feedback_url' => $feedbackUrl,
        ];
    }

    /**
     * Identifier of the current front build (hashed entry file, changes with every build); '' without a build.
     */
    public function build(): string
    {
        return ViteManifest::load($this->publicRoot . '/' . self::MANIFEST)?->entry(self::ENTRY)['file'] ?? '';
    }

    /**
     * JSON safe to embed in <script type="application/json"> (no <, >, &, quotes).
     *
     * @param array<string, mixed> $data
     */
    public static function encodeBootData(array $data): string
    {
        return json_encode($data, self::JSON_FLAGS);
    }

    /**
     * $maintenance: maintenance flag alone (schema up to date); the SPA shows its maintenance screen to
     * everyone but administrators, with a sign-in link.
     */
    public function render(string $basePath, string $routingMode, string $nonce, ?string $csrf = null, bool $maintenance = false, string $feedbackUrl = ''): Response
    {
        $manifest = ViteManifest::load($this->publicRoot . '/' . self::MANIFEST);
        $entry = $manifest?->entry(self::ENTRY);
        if ($entry === null) {
            return Response::html($this->view->render('no-build', ['basePath' => $basePath]));
        }
        $assetUrl = static fn (string $file): string => $basePath . '/assets/' . $file;

        return Response::html($this->view->render('shell', [
            'nonce' => $nonce,
            'script' => $assetUrl($entry['file']),
            'styles' => array_map($assetUrl, $entry['css']),
            'preloads' => array_map($assetUrl, $entry['preload']),
            'bootJson' => self::encodeBootData(self::bootData($basePath, $routingMode, $csrf, $maintenance, $feedbackUrl, $entry['file'])),
        ]));
    }
}
