<?php

declare(strict_types=1);

namespace JDR\Install;

defined('JDR_BOOT') || exit;

/**
 * HTTP answer of the installer (sent by install.php, inspected by tests).
 */
final class Reply
{
    /**
     * @param array<string, string> $headers
     */
    public function __construct(public readonly int $status, public readonly array $headers, public readonly string $body)
    {
    }

    public static function html(string $body, int $status = 200): self
    {
        return new self($status, ['Content-Type' => 'text/html; charset=utf-8'], $body);
    }

    /**
     * @param array<string, mixed> $data
     */
    public static function json(array $data, int $status = 200): self
    {
        return new self(
            $status,
            ['Content-Type' => 'application/json; charset=utf-8'],
            json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
        );
    }

    /**
     * 303: the browser follows with a GET (Post/Redirect/Get).
     */
    public static function redirect(string $location): self
    {
        return new self(303, ['Location' => $location], '');
    }

    /**
     * @param array<string, string> $extraHeaders
     */
    public function send(array $extraHeaders = []): void
    {
        if (!headers_sent()) {
            http_response_code($this->status);
            foreach ($extraHeaders + $this->headers as $name => $value) {
                header($name . ': ' . $value);
            }
        }
        echo $this->body;
    }
}
