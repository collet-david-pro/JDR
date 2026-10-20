<?php

declare(strict_types=1);

namespace JDR\Mail;

defined('JDR_BOOT') || exit;

use JDR\Core\Clock;
use JDR\Core\Logger;
use JDR\Domain\Settings\SecretBox;
use JDR\Domain\Settings\Settings;

/**
 * Sends e-mails with the SMTP settings of the admin (settings.smtp). Disabled when no host or
 * sender is configured ("forgot password" then tells the user to contact the admin).
 */
final class Mailer
{
    /** @var (\Closure(): SmtpTransport)|null */
    private ?\Closure $transportFactory = null;

    public function __construct(
        private Settings $settings,
        private Clock $clock,
        private Logger $logger,
        private ?SecretBox $secretBox = null,
    ) {
    }

    /**
     * @param (\Closure(): SmtpTransport)|null $factory null = real sockets
     */
    public function setTransportFactory(?\Closure $factory): void
    {
        $this->transportFactory = $factory;
    }

    public function isEnabled(): bool
    {
        return $this->settings->smtpEnabled();
    }

    /**
     * @return list<string> SMTP conversation log
     * @throws SmtpException
     */
    public function send(string $to, string $subject, string $text): array
    {
        if (!$this->isEnabled()) {
            throw new SmtpException('SMTP is not configured.');
        }
        $smtp = $this->settings->smtp();
        $password = '';
        if ($smtp['password_enc'] !== '') {
            $password = $this->secretBox?->decrypt($smtp['password_enc']);
            if ($password === null) {
                throw new SmtpException('The stored SMTP password cannot be decrypted (app_secret changed?).');
            }
        }
        $client = new SmtpClient(
            $smtp['host'],
            $smtp['port'],
            $smtp['encryption'],
            $smtp['username'],
            $password,
            10,
            $this->transportFactory === null ? null : ($this->transportFactory)(),
            self::heloName($this->settings->string('base_url')),
        );
        $message = new Message($smtp['from_email'], $smtp['from_name'], $to, $subject, $text);
        try {
            $client->send($message, $this->clock->timestamp());
        } catch (SmtpException $e) {
            $this->logger->warning('SMTP send failed', ['error' => $e->getMessage()]);
            throw new SmtpLogException($e->getMessage(), $client->log(), $e);
        }

        return $client->log();
    }

    private static function heloName(string $baseUrl): string
    {
        $host = parse_url($baseUrl, PHP_URL_HOST);

        return is_string($host) && preg_match('/^[A-Za-z0-9.-]+$/', $host) === 1 ? $host : 'localhost';
    }
}
