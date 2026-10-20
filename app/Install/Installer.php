<?php

declare(strict_types=1);

namespace JDR\Install;

defined('JDR_BOOT') || exit;

use JDR\Domain\Auth\Passwords;

/**
 * install.php controller (projet.md 19). Works without JavaScript: POST forms + redirects,
 * step 5 driven by <noscript> meta refresh (JS only chains the requests without reloading).
 */
final class Installer
{
    private Page $page;

    public function __construct(
        private Env $env,
        private State $state,
        private HttpClient $http,
        string $nonce,
    ) {
        $this->page = new Page($nonce);
    }

    /**
     * @param array<string, mixed> $get
     * @param array<string, mixed> $post
     */
    public function handle(array $get, array $post): Reply
    {
        $step = is_string($get['step'] ?? null) ? $get['step'] : 'requirements';
        $run = $this->state->get('run');
        $phase = is_array($run) ? (string) ($run['phase'] ?? '') : '';

        if ($phase === 'done' && ($step === 'done' || $step === 'run')) {
            return $this->done();
        }
        if (Guard::isInstalled($this->env->root) && !Guard::ownsInstallation($this->env->root, $this->state)) {
            return Reply::html($this->page->render('locked', ['home' => $this->env->basePath() . '/']), 403);
        }
        $isPost = $this->env->method() === 'POST';
        if ($isPost) {
            if (!$this->sameOrigin()) {
                return Reply::html($this->page->render('message', ['message' => Strings::t('err.origin')]), 403);
            }
            if (!$this->state->checkToken($post['_token'] ?? null)) {
                $this->state->set('flash', 'err.token');

                return Reply::redirect(self::url($step));
            }
        }
        // Once step 5 has started, earlier steps are closed (the run is resumable instead).
        if ($phase !== '' && $phase !== 'start' && $step !== 'run') {
            return Reply::redirect(self::url('run'));
        }
        $first = $this->firstIncomplete();
        $index = array_search($step, Page::STEPS, true);
        if ($index === false || $index > array_search($first, Page::STEPS, true)) {
            return Reply::redirect(self::url($first));
        }

        return match ($step) {
            'requirements' => $isPost ? $this->requirementsPost() : $this->requirements(),
            'database' => (new DatabaseStep($this->env, $this->state, $this->page))->handle($isPost, $post),
            'site' => (new SiteStep($this->env, $this->state, $this->page))->handle($isPost, $post),
            'admin' => $isPost ? $this->adminPost($post) : $this->admin([], []),
            'run' => $this->run($isPost, $get, $post),
            default => Reply::redirect(self::url($first)),
        };
    }

    public static function url(string $step, array $query = []): string
    {
        return 'install.php?' . http_build_query(['step' => $step] + $query, '', '&', PHP_QUERY_RFC3986);
    }

    private function firstIncomplete(): string
    {
        $req = $this->state->get('req');
        if (!is_array($req) || ($req['ok'] ?? false) !== true) {
            return 'requirements';
        }
        if (!is_array($this->state->get('db'))) {
            return 'database';
        }
        if (!is_array($this->state->get('site'))) {
            return 'site';
        }
        if (!is_array($this->state->get('admin'))) {
            return 'admin';
        }

        return 'run';
    }

    // ------------------------------------------------------------------ step 1

    private function requirements(): Reply
    {
        $probe = new Probe($this->http);
        $checks = (new Requirements($this->env, $probe))->run();
        $routing = 'query';
        foreach ($checks as $check) {
            if ($check->id === 'routing' && in_array($check->value, ['rewrite', 'query'], true)) {
                $routing = $check->value;
            }
        }
        $worst = Check::worst($checks);
        $this->state->set('req', [
            'ok' => $worst !== Check::ERROR,
            'routing_mode' => $routing,
            'https' => $this->env->isHttps(),
        ]);

        return Reply::html($this->page->render('requirements', [
            'checks' => $checks,
            'worst' => $worst,
            'token' => $this->state->token(),
            'flash' => $this->takeFlash(),
        ], 'requirements'));
    }

    private function requirementsPost(): Reply
    {
        $req = $this->state->get('req');

        return Reply::redirect(self::url(is_array($req) && ($req['ok'] ?? false) === true ? 'database' : 'requirements'));
    }

    // ------------------------------------------------------------------ step 4

    /**
     * @param array<string, mixed>  $values
     * @param array<string, string> $errors
     */
    private function admin(array $values, array $errors): Reply
    {
        $saved = (array) $this->state->get('admin', []);

        return Reply::html($this->page->render('admin', [
            'values' => $values + ['email' => $saved['email'] ?? '', 'username' => $saved['username'] ?? ''],
            'errors' => $errors,
            'token' => $this->state->token(),
            'flash' => $this->takeFlash() ?? ($errors !== [] ? 'err.form' : null),
        ], 'admin'), $errors === [] ? 200 : 422);
    }

    /**
     * @param array<string, mixed> $post
     */
    private function adminPost(array $post): Reply
    {
        [$clean, $errors] = Validator::admin($post);
        if ($errors !== []) {
            return $this->admin(['email' => $clean['email'], 'username' => $clean['username']], $errors);
        }
        // Hashed right away: the clear password never leaves this request.
        $this->state->set('admin', [
            'email' => $clean['email'],
            'username' => $clean['username'],
            'password_hash' => Passwords::hash($clean['password']),
        ]);

        return Reply::redirect(self::url('run'));
    }

    // ------------------------------------------------------------------ step 5

    /**
     * @param array<string, mixed> $get
     * @param array<string, mixed> $post
     */
    private function run(bool $isPost, array $get, array $post): Reply
    {
        $run = $this->state->get('run');
        if ($isPost) {
            if (($post['action'] ?? '') === 'start' && !is_array($run)) {
                $this->state->set('run', Installation::initial());
            }

            return Reply::redirect(self::url('run'));
        }
        if (!is_array($run)) {
            return Reply::html($this->page->render('summary', $this->summary(), 'run'));
        }
        $installation = new Installation($this->env, $this->state);
        $json = ($get['format'] ?? '') === 'json';
        if (($get['do'] ?? '') === '1') {
            if (!$this->state->checkToken($get['k'] ?? null)) {
                return $json ? Reply::json(['error' => Strings::t('err.token')], 403) : Reply::redirect(self::url('run'));
            }
            $result = $installation->run();
            if ($json) {
                return Reply::json($result + ['done_url' => self::url('done')]);
            }
            if ($result['phase'] === 'done') {
                return Reply::redirect(self::url('done'));
            }
        } else {
            $result = [
                'phase' => (string) $run['phase'],
                'log' => is_array($run['log'] ?? null) ? $run['log'] : [],
                'error' => isset($run['error']) ? (string) $run['error'] : null,
                'progress' => ['done' => 0, 'total' => 1],
            ];
            if ($result['phase'] === 'done') {
                return Reply::redirect(self::url('done'));
            }
        }

        $doUrl = self::url('run', ['do' => '1', 'k' => $this->state->token()]);
        $auto = $result['error'] === null && $result['phase'] !== 'await_config';

        return Reply::html($this->page->render('run', [
            'result' => $result,
            'doUrl' => $doUrl,
            'auto' => $auto,
            'config' => $result['phase'] === 'await_config' ? $installation->configContent() : null,
            // Without JavaScript, the page drives itself: one unit of work per reload.
            'head' => $auto ? '<noscript><meta http-equiv="refresh" content="0;url=' . Page::e($doUrl) . '"></noscript>' : '',
        ], 'run'));
    }

    /**
     * @return array<string, mixed>
     */
    private function summary(): array
    {
        $db = (array) $this->state->get('db', []);
        $site = (array) $this->state->get('site', []);
        $admin = (array) $this->state->get('admin', []);
        $req = (array) $this->state->get('req', []);

        return [
            'db' => $db,
            'site' => $site,
            'admin' => $admin,
            'routing' => (string) ($req['routing_mode'] ?? 'query'),
            'storage' => (new Installation($this->env, $this->state))->storagePath(),
            'token' => $this->state->token(),
        ];
    }

    // ------------------------------------------------------------------ step 6

    private function done(): Reply
    {
        $run = (array) $this->state->get('run', []);
        $site = (array) $this->state->get('site', []);
        $req = (array) $this->state->get('req', []);
        $base = rtrim((string) ($site['base_url'] ?? $this->env->baseUrl()), '/');
        $rewrite = ($req['routing_mode'] ?? 'query') === 'rewrite';

        $deleted = 'not_deleted';
        $self = $this->env->root . '/install.php';
        if (is_dir($this->env->root . '/.git')) {
            $deleted = 'dev';
        } elseif (!is_file($self) || @unlink($self)) {
            $deleted = 'deleted';
        }
        $body = $this->page->render('done', [
            'loginUrl' => $base . ($rewrite ? '/login' : '/#/login'),
            'cronUrl' => $base . '/cron.php?key=' . rawurlencode((string) ($run['cron_key'] ?? '')),
            'duration' => (float) ($run['duration_s'] ?? 0),
            'deleted' => $deleted,
        ], 'done');
        $this->state->clear();

        return Reply::html($body);
    }

    // ------------------------------------------------------------------ helpers

    private function takeFlash(): ?string
    {
        $flash = $this->state->get('flash');
        if ($flash !== null) {
            $this->state->remove('flash');
        }

        return is_string($flash) ? $flash : null;
    }

    /**
     * Rejects cross-site POSTs when the browser tells us where they come from.
     */
    private function sameOrigin(): bool
    {
        $origin = $this->env->header('Origin');
        if ($origin === null || $origin === '' || $origin === 'null') {
            return true;
        }
        $host = parse_url($origin, PHP_URL_HOST);
        $port = parse_url($origin, PHP_URL_PORT);
        $hostPort = strtolower((string) $host) . ($port !== null && $port !== false ? ':' . $port : '');

        return $hostPort === $this->env->host();
    }
}
