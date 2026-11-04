<?php

declare(strict_types=1);

namespace JDR\Http\Controllers;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Errors\NotFoundException;
use JDR\Core\Errors\RateLimitedException;
use JDR\Core\Errors\ValidationException;
use JDR\Core\RateLimiter;
use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Domain\Audit\AuditLog;
use JDR\Domain\Auth\CurrentUser;
use JDR\Domain\Settings\Settings;
use JDR\Domain\Support\Validator;
use JDR\Domain\Update\AutoUpdater;
use JDR\Domain\Update\PreUpdateBackup;
use JDR\Domain\Update\RunState;
use JDR\Domain\Update\UpdateChecker;
use JDR\Domain\Update\UpdateException;
use JDR\Domain\Update\UpdatePackage;
use JDR\Domain\Update\UpdateRunner;
use JDR\Domain\Update\UpdateStorage;
use JDR\Domain\Update\UploadStore;

/**
 * /admin/update (role=admin): version check, chunked upload of the update archive, start (the work itself
 * is done by update.php, which keeps running while the site answers 503).
 */
final class AdminUpdateController
{
    public function __construct(
        private UpdateChecker $checker,
        private UpdatePackage $packages,
        private UploadStore $uploads,
        private UpdateRunner $runner,
        private UpdateStorage $storage,
        private Settings $settings,
        private AuditLog $audit,
        private RateLimiter $limiter,
        private Clock $clock,
        private AutoUpdater $auto,
        private PreUpdateBackup $backup,
    ) {
    }

    /**
     * GET /admin/update
     */
    public function show(Request $request): Response
    {
        $this->storage->purge($this->clock->timestamp());
        $backup = $this->backup->status($this->clock->timestamp());
        if ($backup !== null) {
            $backup['token'] = $this->backup->token(CurrentUser::session($request)->csrfToken(), $backup['name']);
        }
        $run = $this->storage->latestRun();
        $dbVersion = $this->settings->get('db_version');

        return Response::ok([
            'current' => \APP_VERSION,
            'db_version' => is_string($dbVersion) ? $dbVersion : null,
            'required_db_version' => \REQUIRED_DB_VERSION,
            'channel' => $this->checker->channel(),
            'auto' => $this->auto->status(),
            'check' => $this->checker->cached(),
            'pending' => $this->packages->pending(),
            'backup' => $backup,
            'run' => $run === null ? null : self::run($run),
            'upload_max_bytes' => UploadStore::MAX_BYTES,
            'chunk_bytes' => UploadStore::chunkBytes(),
            'php' => [
                'upload_max_filesize' => (string) ini_get('upload_max_filesize'),
                'post_max_size' => (string) ini_get('post_max_size'),
            ],
            'update_url' => $request->basePath . '/update.php',
        ]);
    }

    /**
     * GET /admin/update/backup?t=<token> — the database backup taken before the last update (deleted once downloaded).
     */
    public function downloadBackup(Request $request): Response
    {
        CurrentUser::require($request);
        $token = $request->query['t'] ?? null;
        $response = is_string($token)
            ? $this->backup->download($this->clock->timestamp(), CurrentUser::session($request)->csrfToken(), $token)
            : null;

        return $response ?? throw new NotFoundException();
    }

    /**
     * DELETE /admin/update/backup -> 204 ("Do not keep it")
     */
    public function discardBackup(Request $request): Response
    {
        $admin = CurrentUser::require($request);
        $this->backup->discard();
        $this->audit->record($admin->id, 'update.backup_discarded', 'update', null, [], $request->ip());

        return Response::noContent();
    }

    /**
     * POST /admin/update/check {force?: bool} — forced checks limited to 1 per 30 s per admin.
     */
    public function check(Request $request): Response
    {
        $admin = CurrentUser::require($request);
        $v = Validator::fromRequest($request);
        $force = $v->bool('force', false) ?? false;
        $v->validate();
        if ($force) {
            $wait = $this->limiter->attempt(RateLimiter::key('update_check', (string) $admin->id), 1, 30);
            if ($wait !== null) {
                throw new RateLimitedException($wait);
            }
        }

        return Response::ok($this->checker->check($force));
    }

    /**
     * POST /admin/update/install-latest -> 201 {pending: summary} | 409 update.* — "Install now": forced check,
     * verified download of the newer release, accepted as the pending package. Limited like a forced check.
     */
    public function installLatest(Request $request): Response
    {
        $admin = CurrentUser::require($request);
        $wait = $this->limiter->attempt(RateLimiter::key('update_check', (string) $admin->id), 1, 30);
        if ($wait !== null) {
            throw new RateLimitedException($wait);
        }
        try {
            $summary = $this->auto->installLatest($admin->id);
        } catch (UpdateException $e) {
            $this->audit->record($admin->id, 'update.install_latest_refused', 'update', null, ['code' => $e->errorCode()], $request->ip());
            throw $e;
        }
        $this->audit->record($admin->id, 'update.install_latest', 'update', null, [
            'version' => $summary['version'], 'sha256' => $summary['sha256'], 'authenticity' => $summary['authenticity'],
        ], $request->ip());

        return Response::ok(['pending' => $summary], [], 201);
    }

    /**
     * PATCH /admin/update {channel?: stable|prerelease, auto?: bool}
     */
    public function update(Request $request): Response
    {
        $admin = CurrentUser::require($request);
        $v = Validator::fromRequest($request);
        $channel = $v->has('auto') && !$v->has('channel') ? null : (string) $v->in('channel', UpdateChecker::CHANNELS);
        $auto = $v->bool('auto', false);
        $v->validate();
        $out = [];
        if ($channel !== null) {
            $this->checker->setChannel($channel);
            $this->audit->record($admin->id, 'update.channel', 'settings', null, ['channel' => $channel], $request->ip());
            $out['channel'] = $channel;
        }
        if ($auto !== null) {
            $this->auto->setEnabled($auto);
            $this->audit->record($admin->id, 'update.auto', 'settings', null, ['enabled' => $auto], $request->ip());
            $out['auto'] = $this->auto->status();
        }

        return Response::ok($out);
    }

    /**
     * POST /admin/update/uploads {size, sha256} -> 201 {upload_id, chunk_bytes}
     */
    public function createUpload(Request $request): Response
    {
        $admin = CurrentUser::require($request);
        $v = Validator::fromRequest($request);
        $size = (int) $v->int('size', true, 1);
        $sha = (string) $v->string('sha256', true, 64, 64);
        if (!$v->hasErrors() && preg_match('/^[0-9a-fA-F]{64}$/', $sha) !== 1) {
            $v->error('sha256', 'invalid');
        }
        $v->validate();
        if ($this->storage->busyRun() !== null) {
            throw new UpdateException('update.run_in_progress', [], 409);
        }

        return Response::ok($this->uploads->create($size, $sha, $admin->id), [], 201);
    }

    /**
     * PUT /admin/update/uploads/{upload}?offset=<n> (raw body) -> {received}
     */
    public function chunk(Request $request): Response
    {
        $admin = CurrentUser::require($request);
        $offset = $request->query['offset'] ?? null;
        if (!is_string($offset) || !ctype_digit($offset) || strlen($offset) > 12) {
            throw new ValidationException('', ['offset' => 'invalid']);
        }
        $data = $request->rawBody(UploadStore::MAX_CHUNK);
        $received = $this->uploads->append((string) $request->param('upload'), (int) $offset, $data, $admin->id);

        return Response::ok(['received' => $received]);
    }

    /**
     * POST /admin/update/uploads/{upload}/complete -> 201 {pending: summary} | 4xx update.*
     */
    public function complete(Request $request): Response
    {
        $admin = CurrentUser::require($request);
        $uploadId = (string) $request->param('upload');
        $file = $this->uploads->complete($uploadId, $admin->id);
        try {
            $summary = $this->packages->accept($file, $admin->id);
        } catch (UpdateException $e) {
            if ($e->errorCode() !== 'update.run_in_progress') {
                $this->uploads->discard($uploadId); // a refused archive is not kept
            }
            throw $e;
        }
        $this->uploads->discard($uploadId);
        $this->audit->record($admin->id, 'update.uploaded', 'update', null, [
            'version' => $summary['version'], 'sha256' => $summary['sha256'], 'authenticity' => $summary['authenticity'],
        ], $request->ip());

        return Response::ok(['pending' => $summary], [], 201);
    }

    /**
     * DELETE /admin/update/pending -> 204
     */
    public function discard(Request $request): Response
    {
        CurrentUser::require($request);
        if ($this->storage->busyRun() !== null) {
            throw new UpdateException('update.run_in_progress', [], 409);
        }
        $this->packages->discard();

        return Response::noContent();
    }

    /**
     * POST /admin/update/start {confirm_unverified?: bool} -> {redirect, run}
     */
    public function start(Request $request): Response
    {
        $admin = CurrentUser::require($request);
        $v = Validator::fromRequest($request);
        $confirm = $v->bool('confirm_unverified', false) ?? false;
        $v->validate();
        $pending = $this->packages->pending() ?? throw new UpdateException('update.no_package', [], 404);
        $run = $this->runner->prepare((string) $pending['id'], $admin->id, $confirm);

        return Response::ok([
            'redirect' => $request->basePath . '/update.php?id=' . $run['id'],
            'run' => self::run($run),
        ]);
    }

    /**
     * @param array<string, mixed> $state
     * @return array<string, mixed>
     */
    private static function run(array $state): array
    {
        $view = RunState::view($state);

        return [
            'id' => $view['id'], 'mode' => $view['mode'], 'from' => $view['from'], 'to' => $view['to'],
            'step' => $view['step'], 'state' => $view['state'], 'error' => $view['error'],
            'progress' => $view['progress'], 'updated_at' => $view['updated_at'],
        ];
    }
}
