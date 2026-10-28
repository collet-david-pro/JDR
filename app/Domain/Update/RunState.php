<?php

declare(strict_types=1);

namespace JDR\Domain\Update;

defined('JDR_BOOT') || exit;

/**
 * state.json of an update run — FORMAT 1, kept stable on purpose: the classes of the NEW version read and
 * continue a state written by the OLD one (after the copy step) and must be able to restore it.
 * A future change must keep reading format 1 (or bump FORMAT and convert).
 *
 * {
 *   format: 1, id: <32 hex>, mode: "package"|"disk", from: <version>|null, to: <version>,
 *   state: "ready"|"running"|"rolling_back"|"failed"|"failed_migration"|"restoring"|"restored"|"done",
 *   step: one of STEPS[mode] while ready/running, "rollback" while rolling_back,
 *         "restore_db"|"restore_files"|"restore_finish" while restoring, the last step reached otherwise,
 *   error: null|string (French), details: list<string> (e.g. files that failed the check),
 *   user_id: int, package_sha256: string|null, prefix: string (archive folder stripped),
 *   maintenance_was: null|bool (flag before the run; null until maintenance_on ran),
 *   plan: {write: [paths], remove: [paths]}, added: [paths of plan.write absent before the run],
 *   cursor: int (index in the list of the current step), copy_started: bool,
 *   backup: SqlBackup cursor|null, restore: SqlBackup restore cursor|null, bad: [paths] (verify_files),
 *   migrations: [versions applied by this run], log: [{at, message}] (last 100),
 *   created_at, updated_at, finished_at: ISO 8601 UTC|null
 * }
 */
final class RunState
{
    public const FORMAT = 1;

    public const STEPS = [
        'package' => ['verify', 'maintenance_on', 'backup_db', 'backup_files', 'copy', 'verify_files', 'migrate', 'finish'],
        'disk' => ['verify_files', 'maintenance_on', 'backup_db', 'migrate', 'finish'],
    ];

    public const RESTORE_STEPS = ['restore_db', 'restore_files', 'restore_finish'];

    public const TERMINAL = ['done', 'failed', 'restored'];

    /**
     * @param array<string, mixed> $base
     * @return array<string, mixed>
     */
    public static function create(string $id, string $mode, ?string $from, string $to, int $userId, string $now, array $base = []): array
    {
        return $base + [
            'format' => self::FORMAT,
            'id' => $id,
            'mode' => $mode,
            'from' => $from,
            'to' => $to,
            'state' => 'ready',
            'step' => self::STEPS[$mode][0],
            'error' => null,
            'details' => [],
            'user_id' => $userId,
            'package_sha256' => null,
            'prefix' => '',
            'maintenance_was' => null,
            'plan' => ['write' => [], 'remove' => []],
            'added' => [],
            'cursor' => 0,
            'copy_started' => false,
            'backup' => null,
            'restore' => null,
            'bad' => [],
            'migrations' => [],
            'log' => [],
            'created_at' => $now,
            'updated_at' => $now,
            'finished_at' => null,
        ];
    }

    /**
     * @param array<string, mixed> $s
     */
    public static function log(array &$s, string $now, string $message): void
    {
        $log = is_array($s['log'] ?? null) ? $s['log'] : [];
        $log[] = ['at' => $now, 'message' => $message];
        $s['log'] = array_slice($log, -100);
    }

    /**
     * Next step of the mode, or null after the last one.
     */
    public static function next(string $mode, string $step): ?string
    {
        $steps = self::STEPS[$mode] ?? [];
        $i = array_search($step, $steps, true);

        return $i === false ? null : ($steps[$i + 1] ?? null);
    }

    /**
     * Progress for the pages: {done, total, percent, label, detail}.
     *
     * @param array<string, mixed> $s
     * @return array{done:int,total:int,percent:int,label:string,detail:string}
     */
    public static function progress(array $s): array
    {
        $state = (string) ($s['state'] ?? '');
        $step = (string) ($s['step'] ?? '');
        $steps = $state === 'restoring' ? self::RESTORE_STEPS : (self::STEPS[(string) ($s['mode'] ?? 'package')] ?? []);
        $total = count($steps);
        $index = array_search($step, $steps, true);
        $done = match (true) {
            $state === 'done' || $state === 'restored' => $total,
            $index === false => 0,
            default => (int) $index,
        };
        $detail = '';
        $plan = is_array($s['plan'] ?? null) ? $s['plan'] : ['write' => [], 'remove' => []];
        $cursor = (int) ($s['cursor'] ?? 0);
        if (in_array($state, ['running', 'ready'], true)) {
            if ($step === 'backup_files') {
                $detail = $cursor . ' / ' . (count($plan['write']) + count($plan['remove']));
            } elseif ($step === 'copy') {
                $detail = $cursor . ' / ' . (count($plan['write']) + count($plan['remove']));
            } elseif ($step === 'backup_db' && is_array($s['backup'] ?? null)) {
                $detail = (int) $s['backup']['table'] . ' / ' . count((array) $s['backup']['tables']);
            }
        }

        return [
            'done' => $done,
            'total' => $total,
            'percent' => $total > 0 ? (int) round(100 * $done / $total) : 0,
            'label' => UpdateText::t($state === 'rolling_back' ? 'step.rollback' : 'step.' . $step),
            'detail' => $detail,
        ];
    }

    /**
     * Public view for the API / pages.
     *
     * @param array<string, mixed> $s
     * @return array<string, mixed>
     */
    public static function view(array $s): array
    {
        return [
            'id' => $s['id'] ?? null,
            'mode' => $s['mode'] ?? null,
            'from' => $s['from'] ?? null,
            'to' => $s['to'] ?? null,
            'step' => $s['step'] ?? null,
            'state' => $s['state'] ?? null,
            'error' => $s['error'] ?? null,
            'details' => array_slice(is_array($s['details'] ?? null) ? $s['details'] : [], 0, 50),
            'progress' => self::progress($s),
            'log' => array_map(static fn (array $l): string => (string) ($l['message'] ?? ''), array_slice((array) ($s['log'] ?? []), -30)),
            'updated_at' => $s['updated_at'] ?? null,
        ];
    }
}
