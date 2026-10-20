<?php

declare(strict_types=1);

namespace JDR\Mail;

defined('JDR_BOOT') || exit;

/**
 * Line-oriented connection used by SmtpClient (SocketTransport in production, fakes in tests).
 */
interface SmtpTransport
{
    /**
     * @throws SmtpException
     */
    public function connect(string $host, int $port, bool $implicitTls, int $timeout): void;

    /**
     * Upgrades the connection after STARTTLS.
     *
     * @throws SmtpException
     */
    public function enableTls(): void;

    /**
     * One line, CRLF included.
     *
     * @throws SmtpException on timeout or closed connection
     */
    public function readLine(): string;

    /**
     * @throws SmtpException
     */
    public function write(string $data): void;

    public function close(): void;
}
