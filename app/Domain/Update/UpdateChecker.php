<?php

declare(strict_types=1);

namespace JDR\Domain\Update;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Domain\Settings\Settings;
use JDR\Install\HttpResult;

/**
 * "Is there a newer version?" — reads the GitHub releases of REPOSITORY (never downloads an archive).
 *
 * Result: {current, channel, latest: {version, name, published_at, notes, html_url,
 * update_asset: {name, url, size, sha256|null}|null}|null, checked_at, error: null|'unreachable'|'invalid_response'}.
 * Cached in the free setting "update_check" (6 h; 15 min after an error); force bypasses the cache.
 * Never throws: hosts that block outgoing connections just get error = 'unreachable'.
 */
final class UpdateChecker
{
    public const REPOSITORY = 'collet-david-pro/JDR';
    public const SETTING_CACHE = 'update_check';
    public const SETTING_CHANNEL = 'update_channel';
    public const CHANNELS = ['stable', 'prerelease'];
    public const CACHE_SECONDS = 21600;
    public const ERROR_CACHE_SECONDS = 900;
    public const NOTES_MAX = 20000;
    public const SUMS_ASSET = 'SHA256SUMS';

    private ReleaseHttpClient $http;
    private string $current;

    public function __construct(
        private Settings $settings,
        private Clock $clock,
        ?ReleaseHttpClient $http = null,
        ?string $currentVersion = null,
    ) {
        $this->http = $http ?? new NativeReleaseHttpClient(5);
        $this->current = $currentVersion ?? \APP_VERSION;
    }

    public static function apiUrl(): string
    {
        return 'https://api.github.com/repos/' . self::REPOSITORY . '/releases?per_page=10';
    }

    public static function updateAssetName(string $version): string
    {
        return 'jdr-update-v' . $version . '.zip';
    }

    /**
     * Setting update_channel, else "prerelease" while the running version is a pre-release, else "stable".
     */
    public function channel(): string
    {
        $value = $this->settings->get(self::SETTING_CHANNEL);
        if (is_string($value) && in_array($value, self::CHANNELS, true)) {
            return $value;
        }

        return Semver::isPrerelease($this->current) ? 'prerelease' : 'stable';
    }

    public function setChannel(string $channel): void
    {
        if (!in_array($channel, self::CHANNELS, true)) {
            throw new \InvalidArgumentException('Unknown update channel.');
        }
        $this->settings->set(self::SETTING_CHANNEL, $channel);
    }

    /**
     * Last stored result (whatever its age), or null.
     *
     * @return array<string, mixed>|null
     */
    public function cached(): ?array
    {
        $value = $this->settings->get(self::SETTING_CACHE);

        return is_array($value) && array_key_exists('latest', $value) && is_string($value['checked_at'] ?? null) ? $value : null;
    }

    /**
     * @return array<string, mixed>
     */
    public function check(bool $force = false): array
    {
        $channel = $this->channel();
        $cached = $this->cached();
        if (!$force && $cached !== null && ($cached['current'] ?? null) === $this->current
            && ($cached['channel'] ?? null) === $channel) {
            $age = $this->clock->timestamp() - (int) strtotime((string) $cached['checked_at']);
            $ttl = ($cached['error'] ?? null) === null ? self::CACHE_SECONDS : self::ERROR_CACHE_SECONDS;
            if ($age >= 0 && $age < $ttl) {
                return $cached;
            }
        }
        $result = ['current' => $this->current, 'channel' => $channel, 'latest' => null,
            'checked_at' => $this->clock->now()->format('Y-m-d\TH:i:s\Z'), 'error' => null];
        try {
            $answer = $this->http->get(self::apiUrl(), $this->headers('application/vnd.github+json'));
            if ($answer === null) {
                $result['error'] = 'unreachable';
            } else {
                $releases = $answer->status === 200 ? $answer->json() : null;
                if ($releases === null || !array_is_list($releases)) {
                    $result['error'] = 'invalid_response';
                } else {
                    $result['latest'] = $this->pick($releases, $channel);
                }
            }
        } catch (\Throwable) {
            $result['error'] = 'unreachable';
        }
        if ($result['error'] !== null && $cached !== null && ($cached['current'] ?? null) === $this->current
            && ($cached['channel'] ?? null) === $channel) {
            $result['latest'] = $cached['latest']; // keep what was known before the failure
        }
        try {
            $this->settings->set(self::SETTING_CACHE, $result);
        } catch (\Throwable) {
            // The cache is a convenience: a read-only or lagging settings table must not break the check.
        }

        return $result;
    }

    /**
     * Official SHA-256 of jdr-update-v<version>.zip when the stored check knows it (no network access).
     */
    public function officialHash(string $version): ?string
    {
        $latest = $this->cached()['latest'] ?? null;
        if (!is_array($latest) || ($latest['version'] ?? null) !== $version) {
            return null;
        }
        $sha = $latest['update_asset']['sha256'] ?? null;

        return is_string($sha) && preg_match('/^[0-9a-f]{64}$/', $sha) === 1 ? $sha : null;
    }

    /**
     * Highest non-draft release above the current version, on the channel.
     *
     * @param list<mixed> $releases
     * @return array<string, mixed>|null
     */
    private function pick(array $releases, string $channel): ?array
    {
        $best = null;
        $bestVersion = null;
        foreach ($releases as $release) {
            if (!is_array($release) || ($release['draft'] ?? false) === true || !is_string($release['tag_name'] ?? null)) {
                continue;
            }
            $version = Semver::normalize($release['tag_name']);
            if ($version === null || !Semver::greaterThan($version, $this->current)) {
                continue;
            }
            if ($channel === 'stable' && (Semver::isPrerelease($version) || ($release['prerelease'] ?? false) === true)) {
                continue;
            }
            if ($bestVersion === null || Semver::greaterThan($version, $bestVersion)) {
                $best = $release;
                $bestVersion = $version;
            }
        }
        if ($best === null || $bestVersion === null) {
            return null;
        }
        $notes = is_string($best['body'] ?? null) ? $best['body'] : '';
        if (mb_strlen($notes) > self::NOTES_MAX) {
            $notes = mb_substr($notes, 0, self::NOTES_MAX);
        }

        return [
            'version' => $bestVersion,
            'name' => is_string($best['name'] ?? null) && $best['name'] !== '' ? $best['name'] : 'v' . $bestVersion,
            'published_at' => is_string($best['published_at'] ?? null) ? $best['published_at'] : null,
            'notes' => $notes,
            'html_url' => self::httpsUrl($best['html_url'] ?? null),
            'update_asset' => $this->updateAsset($best, $bestVersion),
        ];
    }

    /**
     * @param array<string, mixed> $release
     * @return array{name:string,url:?string,size:int,sha256:?string}|null
     */
    private function updateAsset(array $release, string $version): ?array
    {
        $assets = is_array($release['assets'] ?? null) ? $release['assets'] : [];
        $name = self::updateAssetName($version);
        $asset = null;
        $sums = null;
        foreach ($assets as $item) {
            if (!is_array($item) || !is_string($item['name'] ?? null)) {
                continue;
            }
            if ($item['name'] === $name) {
                $asset = $item;
            } elseif ($item['name'] === self::SUMS_ASSET) {
                $sums = $item;
            }
        }
        if ($asset === null) {
            return null;
        }
        $sha = null;
        $sumsUrl = self::httpsUrl($sums['browser_download_url'] ?? null);
        if ($sumsUrl !== null) {
            $answer = $this->http->get($sumsUrl, $this->headers('application/octet-stream'));
            if ($answer instanceof HttpResult && $answer->status === 200) {
                $sha = self::sumFor($answer->body, $name);
            }
        }

        return [
            'name' => $name,
            'url' => self::httpsUrl($asset['browser_download_url'] ?? null),
            'size' => is_int($asset['size'] ?? null) ? $asset['size'] : 0,
            'sha256' => $sha,
        ];
    }

    /**
     * Hash of $file in a sha256sum listing ("<64 hex>  <name>" or "<64 hex> *<name>", one per line).
     */
    public static function sumFor(string $listing, string $file): ?string
    {
        foreach (preg_split('/\r?\n/', $listing) ?: [] as $line) {
            if (preg_match('/^([0-9a-fA-F]{64}) [ *](.+)$/', trim($line), $m) === 1 && trim($m[2]) === $file) {
                return strtolower($m[1]);
            }
        }

        return null;
    }

    /**
     * @return array<string, string>
     */
    private function headers(string $accept): array
    {
        return ['Accept' => $accept, 'User-Agent' => 'JDR/' . $this->current, 'X-GitHub-Api-Version' => '2022-11-28'];
    }

    private static function httpsUrl(mixed $url): ?string
    {
        return is_string($url) && preg_match('#^https://[^\s]+$#', $url) === 1 ? $url : null;
    }
}
