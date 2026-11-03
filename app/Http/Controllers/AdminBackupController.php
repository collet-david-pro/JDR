<?php

declare(strict_types=1);

namespace JDR\Http\Controllers;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Errors\ValidationException;
use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Core\Session\Session;
use JDR\Domain\Audit\AuditLog;
use JDR\Domain\Auth\CurrentUser;
use JDR\Domain\Backup\AssetsArchive;
use JDR\Domain\Backup\AssetsRestoreJob;
use JDR\Domain\Backup\BackupStorage;
use JDR\Domain\Backup\BackupUploads;
use JDR\Domain\Backup\DbRestore;
use JDR\Domain\Jobs\JobRepository;
use JDR\Domain\Support\Validator;
use JDR\Domain\Update\UpdateStorage;
use JDR\Domain\Update\UploadStore;

/**
 * /admin/backup: one-time backups (jobs db_backup / assets_backup, downloaded through /jobs/{id}/download then
 * deleted) and restores from an uploaded file (database: DbRestore driven by /restore/db/{id}/step; assets: job
 * assets_restore). No backup is kept on the server.
 */
final class AdminBackupController
{
    private const JOB_TYPES = ['db' => 'db_backup', 'assets' => 'assets_backup'];

    public function __construct(
        private BackupStorage $storage,
        private BackupUploads $uploads,
        private DbRestore $restore,
        private JobRepository $jobs,
        private AuditLog $audit,
        private Clock $clock,
    ) {
    }

    /**
     * GET /admin/backup -> {current_version, limits: {db_max_bytes, assets_max_bytes, chunk_bytes}, restore, update_url}
     */
    public function show(Request $request): Response
    {
        CurrentUser::require($request);
        $this->storage->purge($this->clock->timestamp());
        $restore = $this->restore->latest();

        return Response::ok([
            'current_version' => \APP_VERSION,
            'limits' => [
                'db_max_bytes' => BackupUploads::MAX_BYTES['db'],
                'assets_max_bytes' => BackupUploads::MAX_BYTES['assets'],
                'chunk_bytes' => UploadStore::chunkBytes(),
            ],
            'restore' => $restore === null ? null : DbRestore::toPublic($restore),
            'update_url' => $request->basePath . '/update.php',
        ]);
    }

    /**
     * POST /admin/backup/jobs {kind: db|assets} -> 201 {job}
     */
    public function createJob(Request $request): Response
    {
        $admin = CurrentUser::require($request);
        $v = Validator::fromRequest($request);
        $kind = (string) $v->in('kind', array_keys(self::JOB_TYPES));
        $v->validate();
        $now = $this->clock->timestamp();
        $this->storage->purge($now);
        $job = $this->jobs->create(self::JOB_TYPES[$kind], $admin->id, 0, ['work' => UpdateStorage::newId(), 'started' => $now]);
        $this->audit->record($admin->id, 'backup.created', 'backup', null, ['kind' => $kind], $request->ip());

        return Response::ok(['job' => $job->toPublic()], [], 201);
    }

    /**
     * POST /admin/backup/uploads {kind: db|assets, size, sha256?} -> 201 {upload_id, chunk_bytes}
     */
    public function createUpload(Request $request): Response
    {
        $admin = CurrentUser::require($request);
        $v = Validator::fromRequest($request);
        $kind = (string) $v->in('kind', ['db', 'assets']);
        $size = (int) $v->int('size', true, 1);
        $sha = $v->string('sha256', false, 64, 64);
        if ($sha !== null && preg_match('/^[0-9a-fA-F]{64}$/D', $sha) !== 1) {
            $v->error('sha256', 'invalid');
        }
        $v->validate();

        return Response::ok($this->uploads->create($kind, $size, $sha, $admin->id) + ['chunk_bytes' => UploadStore::chunkBytes()], [], 201);
    }

    /**
     * PUT /admin/backup/uploads/{upload}?offset=<n> (raw body) -> {received}
     */
    public function chunk(Request $request): Response
    {
        $admin = CurrentUser::require($request);
        $offset = $request->query['offset'] ?? null;
        if (!is_string($offset) || !ctype_digit($offset) || strlen($offset) > 12) {
            throw new ValidationException('', ['offset' => 'invalid']);
        }
        $data = $request->rawBody(UploadStore::MAX_CHUNK);

        return Response::ok(['received' => $this->uploads->append((string) $request->param('upload'), (int) $offset, $data, $admin->id)]);
    }

    /**
     * POST /admin/backup/restore/db {upload_id} -> 201 {restore (with token)} | 422 backup.invalid_file|too_recent | 409 backup.busy
     */
    public function restoreDb(Request $request): Response
    {
        $admin = CurrentUser::require($request);
        $uploadId = $this->uploadId($request);
        $file = $this->uploads->complete($uploadId, 'db', $admin->id);
        try {
            $state = $this->restore->start($file, $admin->id, $admin->username, $request->ip(), $this->clock->timestamp());
        } finally {
            $this->uploads->discard($uploadId);
        }

        return Response::ok(['restore' => DbRestore::toPublic($state, true)], [], 201);
    }

    /**
     * POST /admin/backup/restore/db/{id}/step {token} -> {restore}. Authorized by the token (not the session user:
     * the users table is being replaced); when done, every session (this one too) is closed.
     */
    public function restoreDbStep(Request $request): Response
    {
        $v = Validator::fromRequest($request);
        $token = (string) $v->string('token', true, 32, 32);
        $v->validate();
        $session = $request->attribute('session');
        $state = $this->restore->step(
            (string) $request->param('id'),
            $token,
            microtime(true) + DbRestore::STEP_SECONDS,
            $session instanceof Session ? $session : null,
        );

        return Response::ok(['restore' => DbRestore::toPublic($state)]);
    }

    /**
     * POST /admin/backup/restore/assets {upload_id} -> 201 {job} (type assets_restore, driven by /jobs/{id}/step)
     */
    public function restoreAssets(Request $request): Response
    {
        $admin = CurrentUser::require($request);
        $uploadId = $this->uploadId($request);
        $file = $this->uploads->complete($uploadId, 'assets', $admin->id);
        try {
            [$zip] = AssetsArchive::open($file);
            $zip->close();
            $work = UpdateStorage::newId();
            $dir = $this->storage->workDir($work, true);
            if (!@rename($file, $dir . '/' . AssetsRestoreJob::ZIP)) {
                throw new \RuntimeException('Cannot move the uploaded archive.');
            }
        } finally {
            $this->uploads->discard($uploadId);
        }
        $job = $this->jobs->create('assets_restore', $admin->id, 0, ['work' => $work]);
        $this->audit->record($admin->id, 'backup.assets_restore', 'backup', null, null, $request->ip());

        return Response::ok(['job' => $job->toPublic()], [], 201);
    }

    private function uploadId(Request $request): string
    {
        $v = Validator::fromRequest($request);
        $id = (string) $v->string('upload_id', true, 32, 32);
        $v->validate();

        return $id;
    }
}
