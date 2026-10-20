<?php

declare(strict_types=1);

namespace JDR\Tests\Domain;

use JDR\Core\Session\MemoryCookieJar;
use JDR\Core\Session\MemorySessionBackend;
use JDR\Core\Session\Session;
use JDR\Core\Session\SessionOptions;
use PHPUnit\Framework\TestCase;

final class SessionTest extends TestCase
{
    private MemoryCookieJar $jar;
    private MemorySessionBackend $backend;

    protected function setUp(): void
    {
        $this->jar = new MemoryCookieJar();
        $this->backend = new MemorySessionBackend($this->jar);
    }

    private function session(?string $cookie, int $now, int $idleHours = 12): Session
    {
        return new Session(
            $this->backend,
            static fn (): SessionOptions => new SessionOptions('/jdr', true, $idleHours * 3600),
            $cookie,
            $now,
        );
    }

    public function testLazyStart(): void
    {
        $s = $this->session(null, 1000);
        self::assertNull($s->get('x'));
        self::assertFalse($s->isStarted());
        $s->commit();
        self::assertSame(0, $this->backend->count());
        self::assertSame([], $this->jar->drain());
    }

    public function testWriteStartsAndPersists(): void
    {
        $s = $this->session(null, 1000);
        $token = $s->csrfToken();
        self::assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $token);
        $s->set('uid', 7);
        $s->commit();
        $cookie = $this->jar->drain()['jdr_sid'];
        self::assertSame('/jdr', $cookie['path']);
        self::assertTrue($cookie['secure']);
        self::assertSame(0, $cookie['expires']);

        $again = $this->session($cookie['value'], 1100);
        self::assertSame(7, $again->get('uid'));
        self::assertSame($token, $again->csrfToken());
    }

    public function testUnknownIdIsNotAccepted(): void
    {
        $s = $this->session('attacker-chosen-session-id', 1000);
        $s->set('x', 1);
        self::assertNotSame('attacker-chosen-session-id', $s->id());
    }

    public function testIdleAndAbsoluteExpiry(): void
    {
        $s = $this->session(null, 1000);
        $s->set('uid', 1);
        $s->commit();
        $id = (string) $s->id();
        $idle = $this->session($id, 1000 + 12 * 3600 + 1);
        self::assertNull($idle->get('uid'));
        self::assertNotSame($id, $idle->id());

        // Active every hour, still expires after 7 days.
        $s = $this->session(null, 0);
        $s->set('uid', 2);
        $s->commit();
        $id = (string) $s->id();
        for ($t = 3600; $t <= 7 * 86400; $t += 3600) {
            $step = $this->session($id, $t);
            self::assertSame(2, $step->get('uid'), 'hour ' . $t / 3600);
            $step->commit();
            $id = (string) $step->id();
        }
        $late = $this->session($id, 7 * 86400 + 3600);
        self::assertNull($late->get('uid'));
    }

    public function testRegeneratesEveryThirtyMinutes(): void
    {
        $s = $this->session(null, 0);
        $s->set('uid', 3);
        $s->commit();
        $id = (string) $s->id();
        $soon = $this->session($id, 1000);
        self::assertSame(3, $soon->get('uid'));
        self::assertSame($id, $soon->id());
        $soon->commit();
        $later = $this->session($id, 1801);
        self::assertSame(3, $later->get('uid'));
        self::assertNotSame($id, $later->id());
        self::assertNull($this->backend->peek($id), 'old id deleted');
    }

    public function testDestroyAndClose(): void
    {
        $s = $this->session(null, 0);
        $s->set('uid', 4);
        $id = (string) $s->id();
        $s->destroy();
        self::assertNull($this->backend->peek($id));
        self::assertSame('', $this->jar->drain()['jdr_sid']['value']);
        self::assertNull($s->get('uid'));

        $c = $this->session(null, 0);
        $c->set('a', 1);
        $c->close();
        self::assertSame(1, $c->get('a'), 'readable after close');
        $this->expectException(\LogicException::class);
        $c->set('b', 2);
    }
}
