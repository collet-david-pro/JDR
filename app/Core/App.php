<?php

declare(strict_types=1);

namespace JDR\Core;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\MaintenanceException;
use JDR\Core\Errors\MethodNotAllowedException;
use JDR\Core\Errors\NotFoundException;
use JDR\Http\Shell;
use JDR\Middleware\Auth;
use JDR\Middleware\Csrf;
use JDR\Middleware\Json;
use JDR\Middleware\Maintenance;
use JDR\Middleware\RateLimit;
use JDR\Middleware\Session;

/**
 * Application kernel: request -> response (projet.md 6.1).
 */
final class App
{
    private const API_PREFIX = '/api/v1';

    private Router $router;

    public function __construct(
        private string $publicRoot,
        private ?Config $config,
        private Container $container,
        private Logger $logger,
        private ErrorHandler $errors,
    ) {
        $this->router = new Router();
        $routes = require dirname(__DIR__) . '/Http/routes.php';
        $routes($this->router);
    }

    /**
     * Production entry: registers the error handler, loads config.php, builds the app.
     */
    public static function boot(string $root): self
    {
        $clock = new Clock();
        $logger = new Logger($root . '/storage/logs', $clock);
        $errors = new ErrorHandler($logger, I18n::forLocale('fr'));
        $errors->register();
        $config = Config::load($root . '/config.php');
        if ($config !== null) {
            $logger->setDirectory($config->storagePath($root) . '/logs');
            $logger->setMinLevel($config->debug() ? 'debug' : 'info');
            $errors->setDebug($config->debug());
        }

        return self::create($root, $config, $logger, $errors, $clock);
    }

    /**
     * Builds the application and its services (also used by tests).
     */
    public static function create(
        string $publicRoot,
        ?Config $config,
        ?Logger $logger = null,
        ?ErrorHandler $errors = null,
        ?Clock $clock = null,
    ): self {
        $clock ??= new Clock();
        $logger ??= new Logger(($config?->storagePath($publicRoot) ?? $publicRoot . '/storage') . '/logs', $clock);
        $i18n = I18n::forLocale('fr');
        $errors ??= new ErrorHandler($logger, $i18n, $config?->debug() ?? false);

        $c = new Container();
        $c->instance(Clock::class, $clock);
        $c->instance(Logger::class, $logger);
        $c->instance(I18n::class, $i18n);
        $c->instance(ErrorHandler::class, $errors);
        $c->set(View::class, static fn (Container $c): View => new View($c->get(I18n::class)));
        $c->set(Shell::class, static fn (Container $c): Shell => new Shell($publicRoot, $c->get(View::class)));
        if ($config !== null) {
            $c->instance(Config::class, $config);
            $c->set(Db::class, static fn (): Db => new Db($config->db()));
            $c->set(Signer::class, static fn (): Signer => new Signer($config->appSecret()));
            $c->set(SystemStatus::class, static fn (Container $c): SystemStatus => SystemStatus::fromDb(
                static fn (): Db => $c->get(Db::class),
                $logger,
            ));
        } else {
            $c->set(SystemStatus::class, static fn (): SystemStatus => SystemStatus::notConfigured());
        }
        $c->set(Maintenance::class, static fn (Container $c): Maintenance => new Maintenance(
            $config,
            $c->get(SystemStatus::class),
            $c->get(I18n::class),
            \REQUIRED_DB_VERSION,
        ));
        $c->set(Cron::class, static fn (Container $c): Cron => new Cron($config, $c->get(Logger::class)));

        return new self($publicRoot, $config, $c, $logger, $errors);
    }

    public function container(): Container
    {
        return $this->container;
    }

    public function config(): ?Config
    {
        return $this->config;
    }

    public function run(): void
    {
        $request = Request::fromGlobals($this->config);
        $this->handle($request)->send($request->method !== 'HEAD');
    }

    public function cron(string $key): int
    {
        return $this->container->get(Cron::class)->run($key);
    }

    public function handle(Request $request): Response
    {
        $nonce = SecurityHeaders::nonce();
        $this->logger->setRequestContext($request->id, $request->method . ' ' . $request->path, microtime(true));
        $this->errors->setRequestContext($request->isApi(), $request->id);
        try {
            $response = $this->dispatch($request, $nonce);
        } catch (\Throwable $e) {
            $response = $this->errors->render(
                $e,
                $request->isApi(),
                $this->container->get(View::class),
                $request->basePath,
            );
        }

        return $this->finalize($response, $request, $nonce);
    }

    private function dispatch(Request $request, string $nonce): Response
    {
        if (PathGuard::isPrivate($request->path)) {
            return Response::text('Forbidden', 403);
        }
        if ($request->isApi()) {
            return $this->dispatchApi($request);
        }

        return $this->dispatchPage($request, $nonce);
    }

    private function dispatchApi(Request $request): Response
    {
        $path = $request->path;
        if ($path !== self::API_PREFIX && !str_starts_with($path, self::API_PREFIX . '/')) {
            throw new NotFoundException();
        }
        $match = $this->router->match($request->method, substr($path, strlen(self::API_PREFIX)) ?: '/');
        $request->setParams($match->params);
        $request->setAttribute('route', $match);
        $this->logger->setRoute($request->method . ' ' . self::API_PREFIX . $match->pattern);

        $pipeline = new Pipeline([
            new Json(),
            $this->container->get(Maintenance::class),
            $this->container->get(Session::class),
            $this->container->get(Auth::class),
            $this->container->get(Csrf::class),
            $this->container->get(RateLimit::class),
        ]);

        return $pipeline->handle($request, function (Request $r) use ($match): Response {
            $handler = $match->handler;
            if ($handler instanceof \Closure) {
                return $handler($r);
            }
            [$class, $method] = $handler;

            return $this->container->get($class)->{$method}($r);
        });
    }

    private function dispatchPage(Request $request, string $nonce): Response
    {
        if ($request->method !== 'GET' && $request->method !== 'HEAD') {
            throw new MethodNotAllowedException(['GET', 'HEAD']);
        }
        $path = $request->path;
        $last = basename($path);
        // Static-looking URLs (missing build files, scripts, sw.js...) never get the SPA shell.
        if (str_starts_with($path, '/assets/') || str_contains($last, '.')) {
            throw new NotFoundException();
        }
        if ($this->config === null) {
            return Response::redirect($request->basePath . '/install.php');
        }
        if ($this->container->get(SystemStatus::class)->needsMaintenance(\REQUIRED_DB_VERSION)) {
            // TODO(P1): redirect a logged-in admin to update.php.
            throw new MaintenanceException();
        }

        return $this->container->get(Shell::class)->render(
            $request->basePath,
            $this->config->routingMode(),
            $nonce,
            null,
        );
    }

    private function finalize(Response $response, Request $request, string $nonce): Response
    {
        $https = $request->isHttps($this->config?->isHttpsBaseUrl() ?? false);
        foreach (SecurityHeaders::headers($nonce, $https) as $name => $value) {
            if (!$response->hasHeader($name)) {
                $response->withHeader($name, $value);
            }
        }
        $response->withHeader('X-Request-Id', $request->id);
        $response->withHeader('X-App-Version', \APP_VERSION);
        $response->withHeader('X-Protocol-Version', (string) \PROTOCOL_VERSION);
        if (!$response->hasHeader('Cache-Control')) {
            $response->withHeader('Cache-Control', 'no-store');
        }

        return $response;
    }
}
