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
            echo $this->body;
        }
    }
}
