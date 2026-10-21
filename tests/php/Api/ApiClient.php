<?php

declare(strict_types=1);

namespace JDR\Tests\Api;

use JDR\Core\App;
use JDR\Core\Request;
use JDR\Core\Response;
use JDR\Core\Session\MemoryCookieJar;
use JDR\Domain\Assets\UploadedFile;

/**
 * A browser for the API tests: keeps cookies (from the MemoryCookieJar) and the CSRF token.
 */
final class ApiClient
{
    /** @var array<string, string> */
    public array $cookies = [];

    public ?string $csrf = null;

    public function __construct(
        private App $app,
        private MemoryCookieJar $jar,
        public string $ip = '203.0.113.10',
        public string $userAgent = 'PHPUnit browser',
    ) {
    }

    public function withApp(App $app): self
    {
        $this->app = $app;

        return $this;
    }

    /**
     * @param array<string, mixed>|null $body
     * @param array<string, string>     $headers
     */
    public function request(string $method, string $path, ?array $body = null, array $headers = [], bool $sendCsrf = true): Response
    {
        $method = strtoupper($method);
        $headers += ['User-Agent' => $this->userAgent];
        $raw = '';
        if ($body !== null) {
            $headers += ['Content-Type' => 'application/json'];
            $raw = json_encode($body, JSON_THROW_ON_ERROR);
        }
        if ($sendCsrf && $this->csrf !== null && $method !== 'GET') {
            $headers += ['X-CSRF-Token' => $this->csrf];
        }
        $request = Request::create($method, '/api/v1' . $path, $headers, $raw, '', ['REMOTE_ADDR' => $this->ip], $this->cookies);

        return $this->send($request);
    }

    /**
     * Multipart upload (no $_FILES in CLI): the file and the text fields are handed to the
     * controller through the request attributes "multipart_files" / "multipart_fields".
     *
     * @param array<string, string> $fields
     * @param array<string, string> $headers
     */
    public function upload(string $path, string $file, array $fields = [], ?string $clientName = null, array $headers = [], int $error = UPLOAD_ERR_OK): Response
    {
        $size = is_file($file) ? (int) filesize($file) : 0;
        $headers += [
            'User-Agent' => $this->userAgent,
            'Content-Type' => 'multipart/form-data; boundary=----jdr',
            'Content-Length' => (string) ($size + 512),
        ];
        if ($this->csrf !== null) {
            $headers += ['X-CSRF-Token' => $this->csrf];
        }
        $request = Request::create('POST', '/api/v1' . $path, $headers, '', '', ['REMOTE_ADDR' => $this->ip], $this->cookies);
        $request->setAttribute('multipart_files', ['file' => UploadedFile::fromPath($file, $clientName ?? basename($file), $error)]);
        $request->setAttribute('multipart_fields', $fields);

        return $this->send($request);
    }

    private function send(Request $request): Response
    {
        $response = $this->app->handle($request);
        foreach ($this->jar->drain() as $name => $cookie) {
            if ($cookie['value'] === '' || ($cookie['expires'] !== 0 && $cookie['expires'] < time())) {
                unset($this->cookies[$name]);
            } else {
                $this->cookies[$name] = $cookie['value'];
            }
        }
        if ($response->status() < 300 && $response->header('Content-Type') === 'application/json; charset=utf-8') {
            $payload = $response->payload();
            if (is_array($payload) && is_array($payload['data'] ?? null) && is_string($payload['data']['csrf'] ?? null)) {
                $this->csrf = $payload['data']['csrf'];
            }
        }

        return $response;
    }

    public function get(string $path): Response
    {
        return $this->request('GET', $path);
    }

    /**
     * @param array<string, mixed>|null $body
     */
    public function post(string $path, ?array $body = []): Response
    {
        return $this->request('POST', $path, $body);
    }

    /**
     * @param array<string, mixed>|null $body
     */
    public function patch(string $path, ?array $body = []): Response
    {
        return $this->request('PATCH', $path, $body);
    }

    /**
     * @param array<string, mixed>|null $body
     */
    public function put(string $path, ?array $body = []): Response
    {
        return $this->request('PUT', $path, $body);
    }

    /**
     * @param array<string, mixed>|null $body
     */
    public function delete(string $path, ?array $body = null): Response
    {
        return $this->request('DELETE', $path, $body);
    }

    /**
     * GET /auth/me (fetches the CSRF token).
     *
     * @return array<string, mixed>
     */
    public function me(): array
    {
        $data = $this->get('/auth/me')->payload()['data'];

        return is_array($data) ? $data : [];
    }

    /**
     * @return array<string, mixed>
     */
    public function login(string $identifier, string $password, bool $remember = false): array
    {
        if ($this->csrf === null) {
            $this->me();
        }
        $response = $this->post('/auth/login', ['identifier' => $identifier, 'password' => $password, 'remember' => $remember]);
        if ($response->status() !== 200) {
            throw new \RuntimeException('Login failed: ' . $response->status() . ' ' . $response->body());
        }

        return $response->payload()['data'];
    }

    /**
     * Forgets the session cookie only (browser restart).
     */
    public function dropSession(): void
    {
        unset($this->cookies['jdr_sid']);
        $this->csrf = null;
    }
}
