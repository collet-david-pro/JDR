<?php

declare(strict_types=1);

namespace JDR\Http\Controllers;

defined('JDR_BOOT') || exit;

use JDR\Core\Config;
use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Domain\Assets\AssetRepository;
use JDR\Domain\Assets\AssetUrls;
use JDR\Domain\Assets\Input;
use JDR\Domain\Auth\CurrentUser;
use JDR\Domain\Procgen\BasePackInstaller;
use JDR\Domain\Procgen\BasePackManifest;

/**
 * Procedural generation (P8): the base pack of placeholders living in the general library.
 */
final class ProcgenController
{
    public function __construct(
        private BasePackInstaller $installer,
        private BasePackManifest $manifest,
        private AssetRepository $assets,
        private AssetUrls $urls,
        private ?Config $config = null,
    ) {
    }

    /**
     * GET /procgen/pack -> {version, assets: {key: {asset_id (string), url (signed, full), name}}}.
     * Deleted or missing assets are left out: the client falls back to another key.
     */
    public function pack(Request $request): Response
    {
        CurrentUser::require($request);
        $ids = $this->installer->ensureInstalled();
        $apiBase = Input::apiBase($request, $this->config);
        $out = [];
        foreach ($ids as $key => $id) {
            $asset = $this->assets->find($id);
            if ($asset === null || $asset->deletedAt !== null) {
                continue;
            }
            $out[$key] = ['asset_id' => (string) $asset->id, 'url' => $this->urls->url($apiBase, $asset->uuid, 'full'), 'name' => $asset->name];
        }
        ksort($out);

        return Response::ok(['version' => $this->manifest->version(), 'assets' => (object) $out]);
    }
}
