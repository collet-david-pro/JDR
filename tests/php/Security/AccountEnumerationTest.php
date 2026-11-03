<?php

declare(strict_types=1);

namespace JDR\Tests\Security;

use JDR\Core\AfterResponse;
use JDR\Domain\Auth\Passwords;
use JDR\Mail\Mailer;
use JDR\Tests\Api\ApiTestCase;
use JDR\Tests\Domain\FakeSmtpTransport;

/**
 * Account enumeration by timing (docs/securite.md, A07): "forgot password" does the same work before the response
 * whether the account exists or not (lookup, link and e-mail are deferred), and a login with an unknown identifier
 * costs one password verification at the current cost, like a known one.
 */
final class AccountEnumerationTest extends ApiTestCase
{
    public function testForgotPasswordDoesNothingBeforeTheResponse(): void
    {
        $this->createUser('Admin', 'admin');
        $this->createUser('Bob');
        $admin = $this->client();
        $admin->login('Admin', self::PASSWORD);
        $admin->patch('/admin/settings', ['smtp' => [
            'host' => 'smtp.example.org', 'port' => 587, 'encryption' => 'starttls', 'username' => 'mailer',
            'password' => 'Smtp-Secret-Value', 'from_email' => 'jdr@example.org',
        ]]);
        $transports = [];
        $this->app->container()->get(Mailer::class)->setTransportFactory(static function () use (&$transports): FakeSmtpTransport {
            return $transports[] = new FakeSmtpTransport(FakeSmtpTransport::happyReplies());
        });
        $after = $this->app->container()->get(AfterResponse::class);
        self::assertSame(0, $after->pending());

        $guest = $this->client('203.0.113.71');
        $guest->me();
        $known = $guest->post('/auth/password/forgot', ['email' => 'bob@example.org']);
        $unknown = $guest->post('/auth/password/forgot', ['email' => 'nobody@example.org']);

        // Same answer, and neither request sent anything nor wrote a link before answering.
        self::assertSame(200, $known->status());
        self::assertSame($known->body(), $unknown->body());
        self::assertSame([], $transports);
        self::assertSame(0, $this->rows('password_resets'));
        self::assertSame(2, $after->pending(), 'one deferred task per request, whatever the account');

        self::assertSame(2, $after->run());
        self::assertCount(1, $transports, 'only the existing account gets an e-mail, after the response');
        self::assertSame(1, $this->rows('password_resets'));
    }

    public function testUnknownLoginCostsOneVerificationAtTheCurrentCost(): void
    {
        $dummy = Passwords::dummyHash();
        self::assertFalse(Passwords::needsRehash($dummy), 'the dummy hash has the cost of a real one');
        self::assertSame($dummy, Passwords::dummyHash(), 'computed at most once per process');
        self::assertSame(password_get_info(Passwords::hash('another-password-1'))['algo'], password_get_info($dummy)['algo']);
    }
}
