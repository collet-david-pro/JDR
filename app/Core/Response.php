<?php

declare(strict_types=1);

namespace JDR\Core;

defined('JDR_BOOT') || exit;

/**
 * HTTP response. API responses use the envelope
 * {ok:true,data,meta} / {ok:false,error:{code,message,fields}} (projet.md 9.1).
 */
final class Response
{
    public const JSON_FLAGS = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
        | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR;

    /** @var array<string, string> canonical name => value */
    private array $headers = [];

    /** @var array{path: string, offset: int, length: int}|null file body (sent in chunks) */
    private ?array $file = null;

    /** Chunk size used when streaming a file body. */
    public const FILE_CHUNK_BYTES = 65536;

    /**
     * @param array<string, string> $headers
     */
    public function __construct(private string $body = '', private int $status = 200, array $headers = [])
    {
        foreach ($headers as $name => $value) {
            $this->withHeader($name, $value);
        }
    }

    /**
     * Success envelope. Identifiers (id, *_id, *_ids) are serialized as strings.
     *
     * @param array<string, mixed> $meta
     */
    public static function ok(mixed $data = null, array $meta = [], int $status = 200): self
    {
        return self::json([
            'ok' => true,
            'data' => Ids::stringify($data),
            'meta' => $meta === [] ? new \stdClass() : Ids::stringify($meta),
        ], $status);
    }

    /**
     * Error envelope.
     *
     * @param array<string, mixed>  $fields
     * @param array<string, string> $headers
     */
    public static function error(
        string $code,
        string $message,
        int $status,
        array $fields = [],
        array $headers = [],
    ): self {
        return self::json([
            'ok' => false,
            'error' => [
                'code' => $code,
                'message' => $message,
                'fields' => $fields === [] ? new \stdClass() : $fields,
            ],
        ], $status, $headers);
    }

    /**
     * @param array<string, string> $headers
     */
    public static function json(mixed $payload, int $status = 200, array $headers = []): self
    {
        return new self(
            json_encode($payload, self::JSON_FLAGS),
            $status,
            ['Content-Type' => 'application/json; charset=utf-8'] + $headers,
        );
    }

    public static function html(string $html, int $status = 200): self
    {
        return new self($html, $status, ['Content-Type' => 'text/html; charset=utf-8']);
    }

    public static function text(string $text, int $status = 200): self
    {
        return new self($text, $status, ['Content-Type' => 'text/plain; charset=utf-8']);
    }

    public static function noContent(): self
    {
        return new self('', 204);
    }

    public static function redirect(string $location, int $status = 302): self
    {
        return new self('', $status, ['Location' => $location]);
    }

    public function status(): int
    {
        return $this->status;
    }

    public function body(): string
    {
        return $this->body;
    }

    /**
     * Decoded JSON body (tests and internal use).
     */
    public function payload(): mixed
    {
        return json_decode($this->body, true, 512, JSON_THROW_ON_ERROR);
    }

    /**
     * @return array<string, string>
     */
    public function headers(): array
    {
        return $this->headers;
    }

    public function header(string $name): ?string
    {
        foreach ($this->headers as $key => $value) {
            if (strcasecmp($key, $name) === 0) {
                return $value;
            }
        }

        return null;
    }

    public function hasHeader(string $name): bool
    {
        return $this->header($name) !== null;
    }

    public function withHeader(string $name, string $value): self
    {
        if (preg_match('/[\r\n]/', $name . $value) === 1) {
            throw new \InvalidArgumentException('Header injection attempt.');
        }
        foreach (array_keys($this->headers) as $key) {
            if (strcasecmp($key, $name) === 0) {
                unset($this->headers[$key]);
            }
        }
        $this->headers[$name] = $value;

        return $this;
    }

    /**
     * Uses (a byte range of) a file as the body: it is streamed in chunks by send(), never
     * loaded in memory. body() stays empty; file() describes what will be sent.
     */
    public function withFile(string $path, int $offset = 0, ?int $length = null): self
    {
        $size = @filesize($path);
        if ($size === false) {
            throw new \RuntimeException('Response file is not readable.');
        }
        $offset = max(0, min($offset, $size));
        $length = $length === null ? $size - $offset : max(0, min($length, $size - $offset));
        $this->file = ['path' => $path, 'offset' => $offset, 'length' => $length];
        $this->body = '';

        return $this;
    }

    /**
     * @return array{path: string, offset: int, length: int}|null
     */
    public function file(): ?array
    {
        return $this->file;
    }

    /**
     * Body as a string, including a file body (tests and small files only).
     */
    public function contents(): string
    {
        if ($this->file === null) {
            return $this->body;
        }
        if ($this->file['length'] === 0) {
            return '';
        }
        $data = file_get_contents($this->file['path'], false, null, $this->file['offset'], $this->file['length']);

        return $data === false ? '' : $data;
    }

    public function withStatus(int $status): self
    {
        $this->status = $status;

        return $this;
    }

    public function send(bool $withBody = true): void
    {
        if (!headers_sent()) {
            http_response_code($this->status);
            foreach ($this->headers as $name => $value) {
                header($name . ': ' . $value, true);
            }
        }
        if ($withBody && $this->status !== 204 && $this->status !== 304) {
            if ($this->file !== null) {
                $this->streamFile($this->file);
            } else {
                echo $this->body;
            }
        }
    }

    /**
     * @param array{path: string, offset: int, length: int} $file
     */
    private function streamFile(array $file): void
    {
        $handle = @fopen($file['path'], 'rb');
        if ($handle === false) {
            return;
        }
        try {
            if ($file['offset'] > 0) {
                fseek($handle, $file['offset']);
            }
            $left = $file['length'];
            while ($left > 0 && !feof($handle)) {
                $chunk = fread($handle, min(self::FILE_CHUNK_BYTES, $left));
                if ($chunk === false || $chunk === '') {
                    break;
                }
                echo $chunk;
                $left -= strlen($chunk);
                if (ob_get_level() === 0) {
                    flush();
                }
                if (connection_aborted() === 1) {
                    break;
                }
            }
        } finally {
            fclose($handle);
        }
    }
}
