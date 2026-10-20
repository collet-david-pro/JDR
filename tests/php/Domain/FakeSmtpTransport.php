<?php

declare(strict_types=1);

namespace JDR\Tests\Domain;

use JDR\Mail\SmtpException;
use JDR\Mail\SmtpTransport;

/**
 * Scripted SMTP server: answers each client line with the next reply, records what was written.
 */
final class FakeSmtpTransport implements SmtpTransport
{
    /** @var list<string> */
    public array $written = [];
    public bool $tls = false;
    public ?string $connectedTo = null;

    /** @var list<string> */
    private array $replies;

    /**
     * @param list<string> $replies raw reply lines (without CRLF), consumed in order
     */
    public function __construct(array $replies)
    {
        $this->replies = $replies;
    }

    /**
     * Replies of a happy-path session with STARTTLS and AUTH PLAIN/LOGIN.
     *
     * @return list<string>
     */
    public static function happyReplies(bool $starttls = true, string $auth = 'PLAIN LOGIN'): array
    {
        $ehlo = ['250-smtp.example.org', '250-8BITMIME'];
        if ($starttls) {
            $ehlo[] = '250-STARTTLS';
        }
        $ehlo[] = '250 AUTH ' . $auth;
        $replies = ['220 smtp.example.org ESMTP', ...$ehlo];
        if ($starttls) {
            $replies = [...$replies, '220 Go ahead', '250-smtp.example.org', '250 AUTH ' . $auth];
        }
        $authReplies = str_starts_with($auth, 'PLAIN') ? ['235 OK'] : ['334 VXNlcm5hbWU6', '334 UGFzc3dvcmQ6', '235 OK'];

        return [...$replies, ...$authReplies, '250 sender ok', '250 rcpt ok', '354 go', '250 queued', '221 bye'];
    }

    public function connect(string $host, int $port, bool $implicitTls, int $timeout): void
    {
        $this->connectedTo = $host . ':' . $port . ($implicitTls ? ' (tls)' : '');
    }

    public function enableTls(): void
    {
        $this->tls = true;
    }

    public function readLine(): string
    {
        if ($this->replies === []) {
            throw new SmtpException('SMTP connection closed.');
        }

        return array_shift($this->replies) . "\r\n";
    }

    public function write(string $data): void
    {
        $this->written[] = $data;
    }

    public function close(): void
    {
    }

    public function transcript(): string
    {
        return implode('', $this->written);
    }
}
