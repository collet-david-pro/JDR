<?php

declare(strict_types=1);

namespace JDR\Domain\Update;

defined('JDR_BOOT') || exit;

use JDR\Core\App;
use JDR\Core\Errors\ForbiddenException;
use JDR\Core\Errors\HttpException;
use JDR\Core\Errors\RateLimitedException;
use JDR\Core\Errors\UnauthenticatedException;
use JDR\Core\Logger;
use JDR\Core\Pipeline;
use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Core\SecurityHeaders;
use JDR\Core\Session\CookieParams;
use JDR\Core\Session\Session;
use JDR\Domain\Auth\AuthService;
use JDR\Domain\Auth\CurrentUser;
use JDR\Middleware\Auth;
use JDR\Middleware\Session as SessionMiddleware;

/**
 * update.php: server-rendered pages, usable without JavaScript, reserved to a logged-in administrator.
 * Reads the application session (same cookie, same handler) without the maintenance middleware.
 * Every POST carries the session CSRF token (_csrf field). Actions (POST "action"):
 * login, start (id, confirm_unverified), start_disk, step (id), retry (id), restore (id).
 * GET: ?id=<id> (summary of a package / progress of a run) or nothing (what is there to do).
 */
final class UpdatePage
{
    public function __construct(
        private UpdateRunner $runner,
        private UpdatePackage $packages,
        private UpdateStorage $storage,
        private AuthService $auth,
        private Logger $logger,
    ) {
    }

    /**
     * Whole request: session + current user, page, security headers.
     */
    public static function respond(App $app, Request $request): Response
    {
        $nonce = SecurityHeaders::nonce();
        $c = $app->container();
        try {
            $page = $c->get(self::class);
            $response = (new Pipeline([$c->get(SessionMiddleware::class), $c->get(Auth::class)]))
                ->handle($request, static fn (Request $r): Response => $page->handle($r, $nonce));
        } catch (\Throwable $e) {
            $c->get(Logger::class)->error('update.php failed', Logger::exceptionContext($e));
            $response = Response::html((new UpdateView($nonce))->render('message', [
                'level' => 'error',
                'message' => UpdateText::t('page.fatal', ['message' => $e->getMessage()]),
                'home' => $request->basePath . '/',
            ]), 500);
        }
        $https = $request->isHttps($app->config()?->isHttpsBaseUrl() ?? false);
        foreach (SecurityHeaders::headers($nonce, $https) + ['Cache-Control' => 'no-store', 'X-Robots-Tag' => 'noindex, nofollow'] as $name => $value) {
            $response->withHeader($name, $value);
        }

        return $response;
    }

    public function handle(Request $request, string $nonce): Response
    {
        $view = new UpdateView($nonce);
        $session = CurrentUser::session($request);
        $self = $request->basePath . '/update.php';
        $json = str_contains((string) $request->header('accept'), 'application/json');
        $fields = [];
        if ($request->method === 'POST') {
            parse_str($request->rawBody(65536), $fields);
            $token = $fields['_csrf'] ?? null;
            if (!is_string($token) || $token === '' || !hash_equals($session->csrfToken(), $token)) {
                return $json
                    ? Response::error('csrf_invalid', UpdateText::t('page.csrf'), 403)
                    : $this->page($view, 'message', ['level' => 'error', 'message' => UpdateText::t('page.csrf'), 'home' => $self], 403);
            }
        } elseif ($request->method !== 'GET' && $request->method !== 'HEAD') {
            return Response::text('Method Not Allowed', 405)->withHeader('Allow', 'GET, HEAD, POST');
        }
        $user = CurrentUser::of($request);
        if ($user === null || !$user->isAdmin()) {
            if (($fields['action'] ?? null) === 'login') {
                return $this->login($request, $session, $view, $fields, $self);
            }

            return $this->page($view, 'login', [
                'csrf' => $session->csrfToken(), 'action' => $self, 'identifier' => '',
                'error' => $user === null ? null : UpdateText::t('login.not_admin'),
            ], $user === null ? 200 : 403);
        }
        try {
            if ($request->method === 'POST') {
                return $this->action($request, (string) ($fields['action'] ?? ''), $fields, $user->id, $self, $json);
            }

            return $this->show($view, (string) ($request->query['id'] ?? ''), $session->csrfToken(), $self, $request->basePath);
        } catch (UpdateException $e) {
            return $json
                ? Response::error($e->errorCode(), $e->getMessage(), $e->status(), $e->fields())
                : $this->page($view, 'message', ['level' => 'error', 'message' => $e->getMessage(), 'home' => $self], $e->status());
        }
    }

    /**
     * @param array<string, mixed> $fields
     */
    private function action(Request $request, string $action, array $fields, int $userId, string $self, bool $json): Response
    {
        $id = (string) ($fields['id'] ?? '');
        $run = match ($action) {
            'start' => $this->runner->prepare($id, $userId, ($fields['confirm_unverified'] ?? '') === '1'),
            'start_disk' => $this->runner->prepareDisk($userId, \REQUIRED_DB_VERSION),
            'step' => $this->runner->step($id),
            'retry' => $this->runner->retry($id),
            'restore' => $this->runner->restore($id),
            default => throw new UpdateException('update.bad_action', [], 400),
        };
        if ($json) {
            return Response::json(['ok' => true, 'busy' => ($run['busy'] ?? false) === true, 'run' => RunState::view($run)]);
        }

        return Response::redirect($self . '?id=' . rawurlencode((string) $run['id']), 303);
    }

    private function show(UpdateView $view, string $id, string $csrf, string $self, string $basePath): Response
    {
        $common = ['csrf' => $csrf, 'action' => $self, 'home' => $basePath . '/'];
        if ($id === '') {
            $busy = $this->storage->busyRun();
            if ($busy !== null) {
                return Response::redirect($self . '?id=' . $busy['id'], 303);
            }
            $pending = $this->packages->pending();
            if ($pending !== null) {
                return Response::redirect($self . '?id=' . $pending['id'], 303);
            }
            $disk = $this->runner->diskStatus(\REQUIRED_DB_VERSION);

            return $this->page($view, 'home', $common + ['disk' => $disk, 'current' => \APP_VERSION]);
        }
        $run = $this->runner->state($id);
        if ($run !== null && $run['state'] !== 'ready') {
            return $this->page($view, 'run', $common + ['run' => RunState::view($run), 'raw' => $run]);
        }
        $package = $this->packages->load($id);
        if ($package === null) {
            return $this->page($view, 'message', ['level' => 'warn', 'message' => UpdateText::t('page.unknown_id'), 'home' => $self], 404);
        }
        if ($run !== null) { // prepared from the admin page: ready to start
            return $this->page($view, 'run', $common + ['run' => RunState::view($run), 'raw' => $run]);
        }

        return $this->page($view, 'summary', $common + ['summary' => $package['summary'] ?? []]);
    }

    /**
     * @param array<string, mixed> $fields
     */
    private function login(Request $request, Session $session, UpdateView $view, array $fields, string $self): Response
    {
        $identifier = trim((string) ($fields['identifier'] ?? ''));
        $password = (string) ($fields['password'] ?? '');
        $error = null;
        try {
            if ($identifier === '' || $password === '' || strlen($identifier) > 191 || strlen($password) > 4096) {
                throw new UnauthenticatedException('', [], 'invalid_credentials');
            }
            $params = $request->attribute('cookie_params');
            $result = $this->auth->login($identifier, $password, false, $request, $session,
                $params instanceof CookieParams ? $params : new CookieParams('/', false));
            if ($result['user']->isAdmin()) {
                return Response::redirect($self, 303);
            }
            $error = UpdateText::t('login.not_admin');
        } catch (RateLimitedException $e) {
            $error = UpdateText::t('login.rate_limited', ['seconds' => $e->headers()['Retry-After'] ?? '60']);
        } catch (ForbiddenException) {
            $error = UpdateText::t('login.suspended');
        } catch (HttpException) {
            $error = UpdateText::t('login.invalid');
        }

        return $this->page($view, 'login', [
            'csrf' => $session->csrfToken(), 'action' => $self, 'identifier' => $identifier, 'error' => $error,
        ], 200);
    }

    /**
     * @param array<string, mixed> $vars
     */
    private function page(UpdateView $view, string $name, array $vars, int $status = 200): Response
    {
        return Response::html($view->render($name, $vars), $status);
    }
}
