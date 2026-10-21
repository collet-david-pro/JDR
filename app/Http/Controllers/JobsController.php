<?php

declare(strict_types=1);

namespace JDR\Http\Controllers;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\GoneException;
use JDR\Core\Errors\NotFoundException;
use JDR\Core\Errors\ValidationException;
use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Domain\Assets\AssetStorage;
use JDR\Domain\Assets\Packs\PackService;
use JDR\Domain\Auth\CurrentUser;
use JDR\Domain\Jobs\Job;
use JDR\Domain\Jobs\JobRepository;
use JDR\Domain\Jobs\JobRunner;

/**
 * User jobs (deviation from projet.md 9.2, which only lists /admin/jobs): only the creator sees
 * and drives a job; others get 404.
 */
final class JobsController
{
    public function __construct(
        private JobRepository $jobs,
        private JobRunner $runner,
        private AssetStorage $storage,
    ) {
    }

    public function show(Request $request): Response
    {
        return Response::ok(['job' => $this->own($request)->toPublic()]);
    }

    /**
     * POST /jobs/{id}/step: one slice of 2-5 s.
     */
    public function step(Request $request): Response
    {
        return Response::ok(['job' => $this->runner->step($this->own($request))->toPublic()]);
    }

    public function cancel(Request $request): Response
    {
        return Response::ok(['job' => $this->runner->cancel($this->own($request))->toPublic()]);
    }

    /**
     * GET /jobs/{id}/download: the archive of a finished export.
     */
    public function download(Request $request): Response
    {
        $job = $this->own($request);
        if ($job->type !== 'pack_export' || $job->status !== Job::DONE) {
            throw new ValidationException('', ['job' => 'not_ready']);
        }
        $zip = $job->state['zip'] ?? null;
        $path = $this->storage->jobsDir() . '/' . (is_string($zip) ? $zip : '');
        if (!PackService::isJobFileName($zip) || !is_file($path)) {
            throw new GoneException('', [], 'job_expired');
        }
        $name = is_string($job->result['file_name'] ?? null) ? $job->result['file_name'] : 'jdr-assets.zip';
        $name = (string) preg_replace('/[^A-Za-z0-9._-]/', '_', $name);

        return (new Response('', 200, [
            'Content-Type' => 'application/zip',
            'Content-Length' => (string) filesize($path),
            'Content-Disposition' => 'attachment; filename="' . $name . '"',
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
        ]))->withFile($path);
    }

    private function own(Request $request): Job
    {
        $user = CurrentUser::require($request);
        $job = $this->jobs->find((int) $request->param('id'));
        if ($job === null || $job->createdBy !== $user->id || !isset(JobRunner::HANDLERS[$job->type])) {
            throw new NotFoundException();
        }

        return $job;
    }
}
