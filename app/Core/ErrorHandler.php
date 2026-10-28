<?php

declare(strict_types=1);

namespace JDR\Core;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\HttpException;
use JDR\Core\Errors\MaintenanceException;

/**
 * Single error handler: PHP errors become exceptions, every exception becomes
 * a normalized response (JSON envelope for the API, HTML page otherwise). 5xx are logged.
 */
final class ErrorHandler
{
    private bool $apiContext = false;
    private ?string $requestId = null;

    public function __construct(
        private Logger $logger,
        private I18n $i18n,
        private bool $debug = false,
    ) {
    }

    public function register(): void
    {
        ini_set('display_errors', '0');
        set_error_handler([$this, 'handleError']);
        set_exception_handler([$this, 'handleUncaught']);
        register_shutdown_function([$this, 'handleShutdown']);
    }

    public function setDebug(bool $debug): void
    {
        $this->debug = $debug;
    }

    public function setRequestContext(bool $api, ?string $requestId): void
    {
        $this->apiContext = $api;
        $this->requestId = $requestId;
    }

    /**
     * @throws \ErrorException
     */
    public function handleError(int $severity, string $message, string $file = '', int $line = 0): bool
    {
        if ((error_reporting() & $severity) === 0) {
            return false;
        }
        if ($severity === E_DEPRECATED || $severity === E_USER_DEPRECATED) {
            $this->logger->warning('Deprecated: ' . $message, ['file' => $file . ':' . $line]);

            return true;
        }
        throw new \ErrorException($message, 0, $severity, $file, $line);
    }

    public function handleUncaught(\Throwable $e): void
    {
        $this->logger->critical('Uncaught exception', Logger::exceptionContext($e));
        $this->emergencyOutput();
    }

    public function handleShutdown(): void
    {
        $error = error_get_last();
        $fatal = E_ERROR | E_PARSE | E_CORE_ERROR | E_COMPILE_ERROR | E_USER_ERROR;
        if ($error === null || ($error['type'] & $fatal) === 0) {
            return;
        }
        $this->logger->critical('Fatal error: ' . $error['message'], ['file' => $error['file'] . ':' . $error['line']]);
        $this->emergencyOutput();
    }

    /**
     * Converts any throwable into a response.
     */
    public function render(\Throwable $e, bool $api, View $view, string $basePath = ''): Response
    {
        if ($e instanceof HttpException) {
            $status = $e->status();
            $code = $e->errorCode();
            $message = $e->getMessage() !== '' ? $e->getMessage() : $this->message($code);
            $fields = $e->fields();
            $headers = $e->headers();
        } else {
            $this->logger->error('Unhandled exception', Logger::exceptionContext($e));
            $status = 500;
            $code = 'internal_error';
            $message = $this->message($code);
            if ($this->debug) {
                $message .= ' [' . get_class($e) . ': ' . $e->getMessage() . ']';
            }
            $fields = [];
            $headers = [];
        }
        if ($status >= 500 && $e instanceof HttpException && $status !== 503) {
            $this->logger->error('Server error', Logger::exceptionContext($e));
        }
        if ($api) {
            return Response::error($code, $message, $status, $fields, $headers);
        }
        $template = $status === 503 ? 'maintenance' : 'error';
        $response = Response::html($view->render($template, [
            'status' => $status,
            'code' => $code,
            'message' => $message,
            'requestId' => $this->requestId,
            'basePath' => $basePath,
            'updateUrl' => $e instanceof MaintenanceException && $e->updatePending ? $basePath . '/update.php' : null,
        ]), $status);
        foreach ($headers as $name => $value) {
            $response->withHeader($name, $value);
        }

        return $response;
    }

    private function message(string $code): string
    {
        $key = 'errors.' . $code;

        return $this->i18n->has($key) ? $this->i18n->t($key) : $this->i18n->t('errors.internal_error');
    }

    private function emergencyOutput(): void
    {
        while (ob_get_level() > 0) {
            ob_end_clean();
        }
        if (headers_sent()) {
            return;
        }
        http_response_code(500);
        header('Cache-Control: no-store');
        if ($this->requestId !== null) {
            header('X-Request-Id: ' . $this->requestId);
        }
        if ($this->apiContext) {
            header('Content-Type: application/json; charset=utf-8');
            echo json_encode([
                'ok' => false,
                'error' => [
                    'code' => 'internal_error',
                    'message' => $this->message('internal_error'),
                    'fields' => new \stdClass(),
                ],
            ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

            return;
        }
        header('Content-Type: text/plain; charset=utf-8');
        echo $this->message('internal_error');
        if ($this->requestId !== null) {
            echo "\n" . $this->i18n->t('pages.error.request_id', ['id' => $this->requestId]);
        }
    }
}
