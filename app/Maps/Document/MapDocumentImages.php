<?php

declare(strict_types=1);

namespace JDR\Maps\Document;

defined('JDR_BOOT') || exit;

use JDR\Maps\ObjectRulesImage;

/**
 * Image objects in map documents (P14). An image object carries, next to its API form, the hash of
 * its asset: "asset": "sha256:<hex>" (top-level key, like revealed_at). Exported documents have
 * props.asset_id null (ids mean nothing on another server); internal documents (version snapshots)
 * keep it. On import / restore, the asset is found again (kept id when it still exists, else by
 * hash among the importer's assets and the general library); an image whose asset cannot be found
 * is left out and listed in missing_assets.
 */
final class MapDocumentImages
{
    private const ASSET_PATTERN = '/^sha256:([0-9a-f]{64})$/D';

    /**
     * Document form of the image objects of $objects (others unchanged); an image whose asset row
     * no longer exists is left out.
     *
     * @param list<array<string, mixed>> $objects API form
     * @param array<int, string>         $hashes  asset id => sha256 (lower-case hex)
     * @return list<array<string, mixed>>
     */
    public static function export(array $objects, array $hashes, bool $internal): array
    {
        $out = [];
        foreach ($objects as $object) {
            if (ObjectRulesImage::handles($object['type'] ?? null)) {
                $id = ObjectRulesImage::assetId($object);
                $sha = $id === null ? null : ($hashes[$id] ?? null);
                if ($sha === null) {
                    continue;
                }
                if (!$internal) {
                    $object['props']['asset_id'] = null;
                }
                $object['asset'] = 'sha256:' . $sha;
            }
            $out[] = $object;
        }

        return $out;
    }

    /**
     * Takes the "asset" key out of a document object (before ObjectRules::object): [item, sha256 | null].
     * An image object must carry it (422 <field>.asset = required / invalid).
     *
     * @param array<string, string> $errors
     * @return array{0: mixed, 1: ?string}
     */
    public static function take(mixed $item, string $field, array &$errors): array
    {
        if (!is_array($item)) {
            return [$item, null];
        }
        $isImage = ObjectRulesImage::handles($item['type'] ?? null);
        if (!array_key_exists('asset', $item)) {
            if ($isImage) {
                $errors[$field . '.asset'] = 'required';
            }

            return [$item, null];
        }
        $value = $item['asset'];
        unset($item['asset']);
        if (!$isImage || !is_string($value) || preg_match(self::ASSET_PATTERN, strtolower($value), $m) !== 1) {
            $errors[$field . '.asset'] = 'invalid';

            return [$item, null];
        }

        return [$item, $m[1]];
    }

    /**
     * Hashes of the image assets of normalized document objects.
     *
     * @param list<array<string, mixed>> $objects
     * @return list<string>
     */
    public static function hashes(array $objects): array
    {
        $out = [];
        foreach ($objects as $object) {
            if (ObjectRulesImage::handles($object['type'] ?? null) && is_string($object['asset'] ?? null)) {
                $out[$object['asset']] = $object['asset'];
            }
        }

        return array_values($out);
    }

    /**
     * Asset ids of the image objects of a normalized document: the recorded id when it is in
     * $existing (restore), else the asset found by hash; unresolved images are left out and added to
     * $missing (ref => {ref, name}).
     *
     * @param list<array<string, mixed>>                        $objects
     * @param array<string, int>                                $bySha    sha256 => asset id
     * @param array<int, true>                                  $existing asset ids that still exist
     * @param array<string, array{ref: string, name: string}>   $missing
     * @return list<array<string, mixed>>
     */
    public static function resolve(array $objects, array $bySha, array $existing, array &$missing): array
    {
        $out = [];
        foreach ($objects as $object) {
            if (ObjectRulesImage::handles($object['type'] ?? null)) {
                $id = ObjectRulesImage::assetId($object);
                $sha = is_string($object['asset'] ?? null) ? $object['asset'] : null;
                if ($id === null || !isset($existing[$id])) {
                    $id = $sha === null ? null : ($bySha[$sha] ?? null);
                }
                if ($id === null) {
                    if ($sha !== null) {
                        $missing['sha256:' . $sha] ??= ['ref' => 'sha256:' . $sha, 'name' => ''];
                    }
                    continue;
                }
                $object['props']['asset_id'] = (string) $id;
            }
            unset($object['asset']);
            $out[] = $object;
        }

        return $out;
    }
}
