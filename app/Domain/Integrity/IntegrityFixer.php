<?php

declare(strict_types=1);

namespace JDR\Domain\Integrity;

defined('JDR_BOOT') || exit;

use JDR\Core\Db;
use JDR\Core\Errors\ValidationException;
use JDR\Domain\Assets\AssetIntegrity;
use JDR\Domain\Assets\AssetRepository;
use JDR\Domain\Assets\AssetStorage;
use JDR\Domain\Audit\AuditLog;

/**
 * Applies the corrections proposed by the check. Each issue is recomputed from its own subject first
 * (nothing is done when it is already fixed); the request subject is never trusted, only the id is.
 */
final class IntegrityFixer
{
    public const MAX_ISSUES = 200;

    public function __construct(
        private Db $db,
        private IntegrityScanner $scanner,
        private AssetIntegrity $assets,
        private AssetStorage $storage,
        private AssetRepository $assetRepo,
        private AuditLog $audit,
    ) {
    }

    /**
     * @param list<array{id: string, kind: string}> $requested
     * @return array{fixed: list<string>, skipped: list<array{id: string, reason: string}>}
     */
    public function fix(int $adminId, array $requested, bool $confirm, string $ip): array
    {
        foreach ($requested as $r) {
            if (!array_key_exists($r['kind'], Issue::FIXES)) {
                throw new ValidationException('', ['issues' => 'invalid']);
            }
            if ($r['kind'] === 'orphan_file' && !self::safePath(substr($r['id'], strlen('orphan_file:')))) {
                throw new ValidationException('', ['issues' => 'invalid_path'], 'integrity.invalid_path');
            }
        }
        if (!$confirm) {
            foreach ($requested as $r) {
                if (Issue::destructive($r['kind'])) {
                    throw new ValidationException('', ['confirm' => 'required'], 'integrity.confirm_required');
                }
            }
        }
        $fixed = [];
        $skipped = [];
        foreach ($requested as $r) {
            $prefix = $r['kind'] . ':';
            if (!str_starts_with($r['id'], $prefix) || Issue::FIXES[$r['kind']] === null) {
                $skipped[] = ['id' => $r['id'], 'reason' => 'invalid'];
                continue;
            }
            $key = substr($r['id'], strlen($prefix));
            $issue = null;
            foreach ($this->scanner->forSubject($r['kind'], $key) as $candidate) {
                if ($candidate->id() === $r['id']) {
                    $issue = $candidate;
                    break;
                }
            }
            if ($issue === null) {
                $skipped[] = ['id' => $r['id'], 'reason' => 'already_fixed'];
                continue;
            }
            $this->db->transaction(function () use ($issue): void {
                $this->apply($issue);
            });
            $this->audit->record($adminId, 'integrity.fix', (string) ($issue->subject['type'] ?? 'file'), isset($issue->subject['id']) ? (int) $issue->subject['id'] : null, [
                'kind' => $issue->kind, 'action' => Issue::FIXES[$issue->kind][0], 'issue' => $issue->id(),
            ], $ip);
            $fixed[] = $issue->id();
        }

        return ['fixed' => $fixed, 'skipped' => $skipped];
    }

    /**
     * Relative path below storage/assets/, without any trick.
     */
    public static function safePath(string $path): bool
    {
        return preg_match('#^assets/[A-Za-z0-9_.\-/]{1,200}$#D', $path) === 1
            && !str_contains($path, '..') && !str_contains($path, '//') && !str_ends_with($path, '/');
    }

    private function apply(Issue $issue): void
    {
        $s = $issue->subject;
        switch ($issue->kind) {
            case 'quota_mismatch':
                $this->recalcQuota((int) $s['user_id']);
                break;
            case 'size_mismatch':
                $row = $this->db->fetchOne('SELECT * FROM ' . $this->db->t('assets') . ' WHERE `id` = ?', [(int) $s['id']]);
                if ($row !== null) {
                    [$size, $thumb] = $this->assets->assetSizes($row);
                    $this->db->execute(
                        'UPDATE ' . $this->db->t('assets') . ' SET `size_bytes` = ?, `thumb_size_bytes` = ? WHERE `id` = ?',
                        [$size, $thumb, (int) $row['id']],
                    );
                    if ($row['owner_user_id'] !== null) {
                        $this->recalcQuota((int) $row['owner_user_id']);
                    }
                }
                break;
            case 'asset_refs_mismatch':
                $this->recalcRefs((int) $s['id']);
                break;
            case 'revision_ahead':
                $this->db->execute(
                    'UPDATE ' . $this->db->t('maps') . ' SET `revision` = ? WHERE `id` = ? AND `revision` < ?',
                    [(int) $issue->details['max_revision'], (int) $s['id'], (int) $issue->details['max_revision']],
                );
                break;
            case 'missing_file':
                $row = $this->db->fetchOne('SELECT `owner_user_id`, `ext` FROM ' . $this->db->t('assets') . ' WHERE `id` = ?', [(int) $s['id']]);
                $this->assetRepo->hardDelete((int) $s['id']);
                $this->storage->deleteFiles((string) $s['uuid'], (string) ($row['ext'] ?? ''));
                if ($row !== null && $row['owner_user_id'] !== null) {
                    $this->recalcQuota((int) $row['owner_user_id']);
                }
                break;
            case 'orphan_file':
                $this->storage->remove($this->storage->root() . '/' . $s['path']);
                break;
            case 'undecodable_chunk':
                $this->db->execute(
                    'DELETE FROM ' . $this->db->t('map_chunks') . ' WHERE `map_id` = ? AND `floor_id` = ? AND `layer` = ? AND `cx` = ? AND `cy` = ?',
                    [$s['map_id'], $s['floor_id'], $s['layer'], $s['cx'], $s['cy']],
                );
                $this->recalcRefs((int) $s['map_id']);
                break;
            case 'undecodable_fog':
                $this->db->execute(
                    'DELETE FROM ' . $this->db->t('map_fog') . ' WHERE `map_id` = ? AND `floor_id` = ? AND `cx` = ? AND `cy` = ?',
                    [$s['map_id'], $s['floor_id'], $s['cx'], $s['cy']],
                );
                break;
        }
    }

    private function recalcQuota(int $userId): void
    {
        $this->db->execute(
            'UPDATE ' . $this->db->t('users') . ' SET `storage_used_bytes` = ? WHERE `id` = ?',
            [$this->assets->actualBytes($userId), $userId],
        );
    }

    private function recalcRefs(int $mapId): void
    {
        $t = $this->db->t('map_asset_refs');
        $this->db->fetchValue('SELECT `id` FROM ' . $this->db->t('maps') . ' WHERE `id` = ? FOR UPDATE', [$mapId]);
        $this->db->execute('DELETE FROM ' . $t . ' WHERE `map_id` = ?', [$mapId]);
        foreach ($this->scanner->expectedRefs($mapId) as $assetId => $n) {
            $this->db->execute('INSERT INTO ' . $t . ' (`map_id`, `asset_id`, `ref_count`) VALUES (?, ?, ?)', [$mapId, $assetId, $n]);
        }
    }
}
