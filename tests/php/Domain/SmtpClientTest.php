<?php

declare(strict_types=1);

namespace JDR\Tests\Domain;

use JDR\Mail\Message;
use JDR\Mail\SmtpClient;
use JDR\Mail\SmtpException;
use PHPUnit\Framework\TestCase;

final class SmtpClientTest extends TestCase
{
    private static function message(string $text = "Bonjour\n.ligne qui commence par un point\nFin", string $subject = 'Réinitialisation du mot de passe'): Message
    {
        return new Message('jdr@example.org', 'Table de Jeu', 'bob@example.org', $subject, $text);
    }

    public function testStartTlsAuthPlainAndData(): void
    {
        $transport = new FakeSmtpTransport(FakeSmtpTransport::happyReplies());
        $client = new SmtpClient('smtp.example.org', 587, 'starttls', 'mailer', 's3cr3t-pass', 5, $transport, 'jdr.example.org');
        $client->send(self::message(), 1_800_000_000);

        self::assertSame('smtp.example.org:587', $transport->connectedTo);
        self::assertTrue($transport->tls);
        $w = $transport->written;
        self::assertSame("EHLO jdr.example.org\r\n", $w[0]);
        self::assertSame("STARTTLS\r\n", $w[1]);
        self::assertSame("EHLO jdr.example.org\r\n", $w[2]);
        self::assertSame('AUTH PLAIN ' . base64_encode("\0mailer\0s3cr3t-pass") . "\r\n", $w[3]);
        self::assertSame("MAIL FROM:<jdr@example.org>\r\n", $w[4]);
        self::assertSame("RCPT TO:<bob@example.org>\r\n", $w[5]);
        self::assertSame("DATA\r\n", $w[6]);
        $data = $w[7];
        self::assertStringEndsWith("\r\n.\r\n", $data);
        self::assertStringContainsString("\r\n..ligne qui commence par un point\r\n", $data, 'dot-stuffing');
        self::assertStringContainsString('Subject: =?UTF-8?B?', $data);
        self::assertStringContainsString('From: "Table de Jeu" <jdr@example.org>', $data);
        self::assertStringContainsString('Content-Transfer-Encoding: quoted-printable', $data);
        self::assertStringContainsString('Date: Fri, 15 Jan 2027 08:00:00 +0000', $data);
        self::assertSame("QUIT\r\n", $w[8]);
        self::assertSame(0, preg_match("/(?<!\r)\n/", $data), 'only CRLF line endings');

        $log = implode("\n", $client->log());
        self::assertStringNotContainsString('s3cr3t-pass', $log);
        self::assertStringNotContainsString(base64_encode("\0mailer\0s3cr3t-pass"), $log);
        self::assertStringContainsString('[credentials hidden]', $log);
    }

    public function testAuthLoginAndImplicitTls(): void
    {
        $transport = new FakeSmtpTransport(FakeSmtpTransport::happyReplies(false, 'LOGIN'));
        $client = new SmtpClient('smtp.example.org', 465, 'tls', 'mailer', 'pw', 5, $transport);
        $client->send(self::message('Hi'), 0);
        self::assertSame('smtp.example.org:465 (tls)', $transport->connectedTo);
        self::assertFalse($transport->tls);
        self::assertSame("AUTH LOGIN\r\n", $transport->written[1]);
        self::assertSame(base64_encode('mailer') . "\r\n", $transport->written[2]);
        self::assertSame(base64_encode('pw') . "\r\n", $transport->written[3]);
        self::assertStringNotContainsString(base64_encode('pw'), implode("\n", $client->log()));
    }

    public function testQuotedPrintableUtf8Body(): void
    {
        $mime = self::message("Été à l'auberge — 100 % sûr\n" . str_repeat('x', 200))->toMime(0);
        [, $body] = explode("\r\n\r\n", $mime, 2);
        self::assertStringContainsString('=C3=89t=C3=A9', $body);
        foreach (explode("\r\n", $body) as $line) {
            self::assertLessThanOrEqual(76, strlen($line));
        }
        self::assertSame("Été à l'auberge — 100 % sûr\r\n" . str_repeat('x', 200), quoted_printable_decode($body));
        $subject = Message::encodeHeader('Réinitialisation');
        self::assertSame('Réinitialisation', mb_decode_mimeheader($subject));
        self::assertSame('Plain ASCII', Message::encodeHeader('Plain ASCII'));
        self::assertStringNotContainsString("\n", str_replace("\r\n ", '', Message::encodeHeader("Inject\r\nBcc: x@y")));
    }

    public function testRefusesHeaderInjectionInAddresses(): void
    {
        $this->expectException(SmtpException::class);
        new Message('jdr@example.org', 'JDR', "bob@example.org\r\nBcc: evil@example.org", 'S', 'T');
    }

    public function testStartTlsRequiredButMissing(): void
    {
        $transport = new FakeSmtpTransport(['220 hi', '250-smtp', '250 AUTH PLAIN']);
        $client = new SmtpClient('smtp.example.org', 587, 'starttls', '', '', 5, $transport);
        try {
            $client->send(self::message(), 0);
            self::fail('expected SmtpException');
        } catch (SmtpException $e) {
            self::assertStringContainsString('STARTTLS', $e->getMessage());
        }
        self::assertStringContainsString('! The server does not support STARTTLS.', implode("\n", $client->log()));
    }

    public function testRejectedRecipient(): void
    {
        $transport = new FakeSmtpTransport(['220 hi', '250 smtp', '250 ok', '550 no such user']);
        $client = new SmtpClient('smtp.example.org', 25, 'none', '', '', 5, $transport);
        $this->expectException(SmtpException::class);
        $this->expectExceptionMessage('550 no such user');
        $client->send(self::message(), 0);
    }

    public function testDotStuffing(): void
    {
        self::assertSame("a\r\n..b\r\n..\r\nc", SmtpClient::dotStuff("a\n.b\n.\nc"));
    }
}
