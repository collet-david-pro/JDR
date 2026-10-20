<?php

declare(strict_types=1);

namespace JDR\Mail;

defined('JDR_BOOT') || exit;

/**
 * Minimal SMTP client (projet.md 6.7): EHLO, STARTTLS or implicit TLS, AUTH PLAIN/LOGIN,
 * MAIL FROM, RCPT TO, DATA (dot-stuffing), QUIT, timeouts.
 * The conversation log never contains credentials nor the message body.
 */
final class SmtpClient
{
    public const ENCRYPTIONS = ['none', 'starttls', 'tls'];

    /** @var list<string> */
    private array $log = [];

    /** @var list<string> EHLO extension lines (upper case) */
    private array $extensions = [];

    private SmtpTransport $transport;

    public function __construct(
        private string $host,
        private int $port,
        private string $encryption,
        private string $username,
        #[\SensitiveParameter] private string $password,
        private int $timeout = 10,
        ?SmtpTransport $transport = null,
        private string $heloName = 'localhost',
    ) {
        if (!in_array($encryption, self::ENCRYPTIONS, true)) {
            throw new SmtpException('Unknown encryption: ' . $encryption);
        }
        $this->transport = $transport ?? new SocketTransport();
    }

    /**
     * @throws SmtpException
     */
    public function send(Message $message, int $timestamp): void
    {
        $this->log = [];
        try {
            $this->transport->connect($this->host, $this->port, $this->encryption === 'tls', $this->timeout);
            $this->log[] = '* connected to ' . $this->host . ':' . $this->port;
            $this->expect([220]);
            $this->ehlo();
            if ($this->encryption === 'starttls') {
                if (!$this->supports('STARTTLS')) {
                    throw new SmtpException('The server does not support STARTTLS.');
                }
                $this->command('STARTTLS', [220]);
                $this->transport->enableTls();
                $this->log[] = '* TLS enabled';
                $this->ehlo();
            }
            if ($this->username !== '') {
                $this->authenticate();
            }
            $this->command('MAIL FROM:<' . $message->fromEmail . '>', [250]);
            $this->command('RCPT TO:<' . $message->to . '>', [250, 251]);
            $this->command('DATA', [354]);
            $data = self::dotStuff($message->toMime($timestamp));
            $this->transport->write($data . "\r\n.\r\n");
            $this->log[] = '> [message: ' . strlen($data) . ' bytes]';
            $this->expect([250]);
            try {
                $this->command('QUIT', [221]);
            } catch (SmtpException) {
                // The message is accepted; a sloppy QUIT is not an error.
            }
        } catch (SmtpException $e) {
            $this->log[] = '! ' . $e->getMessage();
            throw $e;
        } finally {
            $this->transport->close();
        }
    }

    /**
     * @return list<string>
     */
    public function log(): array
    {
        return $this->log;
    }

    /**
     * Lines starting with "." get an extra "." (RFC 5321 4.5.2).
     */
    public static function dotStuff(string $data): string
    {
        $data = str_replace(["\r\n", "\r"], "\n", $data);
        $lines = explode("\n", $data);
        foreach ($lines as $i => $line) {
            if (str_starts_with($line, '.')) {
                $lines[$i] = '.' . $line;
            }
        }

        return implode("\r\n", $lines);
    }

    private function ehlo(): void
    {
        $lines = $this->command('EHLO ' . $this->heloName, [250]);
        $this->extensions = array_map(static fn (string $l): string => strtoupper(trim(substr($l, 4))), array_slice($lines, 1));
    }

    private function supports(string $extension): bool
    {
        foreach ($this->extensions as $line) {
            if ($line === $extension || str_starts_with($line, $extension . ' ')) {
                return true;
            }
        }

        return false;
    }

    /**
     * @return list<string>
     */
    private function authMechanisms(): array
    {
        foreach ($this->extensions as $line) {
            if (preg_match('/^AUTH[ =](.*)$/', $line, $m) === 1) {
                return preg_split('/\s+/', trim($m[1])) ?: [];
            }
        }

        return [];
    }

    private function authenticate(): void
    {
        $mechanisms = $this->authMechanisms();
        if (in_array('PLAIN', $mechanisms, true)) {
            $this->command(
                'AUTH PLAIN ' . base64_encode("\0" . $this->username . "\0" . $this->password),
                [235],
                'AUTH PLAIN [credentials hidden]',
            );

            return;
        }
        if (in_array('LOGIN', $mechanisms, true) || $mechanisms === []) {
            $this->command('AUTH LOGIN', [334]);
            $this->command(base64_encode($this->username), [334], '[username hidden]');
            $this->command(base64_encode($this->password), [235], '[password hidden]');

            return;
        }
        throw new SmtpException('No supported authentication mechanism (PLAIN, LOGIN).');
    }

    /**
     * @param list<int> $expected
     * @return list<string> response lines
     */
    private function command(string $line, array $expected, ?string $logAs = null): array
    {
        $this->transport->write($line . "\r\n");
        $this->log[] = '> ' . ($logAs ?? $line);

        return $this->expect($expected);
    }

    /**
     * Reads a (multi-line) reply and checks its code.
     *
     * @param list<int> $expected
     * @return list<string>
     */
    private function expect(array $expected): array
    {
        $lines = [];
        for ($i = 0; $i < 100; $i++) {
            $line = rtrim($this->transport->readLine(), "\r\n");
            $lines[] = $line;
            $this->log[] = '< ' . $line;
            if (strlen($line) < 4 || $line[3] !== '-') {
                break;
            }
        }
        $code = (int) substr($lines[count($lines) - 1] ?? '', 0, 3);
        if (!in_array($code, $expected, true)) {
            throw new SmtpException('Unexpected SMTP reply: ' . ($lines[count($lines) - 1] ?? ''));
        }

        return $lines;
    }
}
