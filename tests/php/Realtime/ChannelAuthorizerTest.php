<?php

declare(strict_types=1);

namespace JDR\Tests\Realtime;

use JDR\Core\Errors\ForbiddenException;
use JDR\Core\Errors\HttpException;
use JDR\Core\Errors\NotFoundException;
use JDR\Core\Errors\ValidationException;
use JDR\Realtime\Audience;
use JDR\Realtime\ChannelAuthorizer;

/**
 * Channel rights (contract P6a): session = gm or non-kicked player, map = gm of the game.
 */
final class ChannelAuthorizerTest extends RealtimeTestCase
{
    private function authorizer(): ChannelAuthorizer
    {
        return $this->app->container()->get(ChannelAuthorizer::class);
    }

    /**
     * @param list<string> $channels
     * @return int|string HTTP status of the refusal, or "role,role" when granted
     */
    private function outcome(string $username, array $channels): int|string
    {
        try {
            $sub = $this->authorizer()->authorize($this->userId($username), $channels);

            return implode(',', array_map(static fn (string $c): string => (string) $sub->roleOn($c), $sub->channels()));
        } catch (HttpException $e) {
            return $e->status();
        }
    }

    public function testParse(): void
    {
        self::assertSame(['session:12', 'map:34'], ChannelAuthorizer::parse(' session:12, map:34 ,session:12'));
        foreach ([null, '', '  ', ['session:1']] as $raw) {
            self::assertSame(['channels' => 'required'], $this->fields(static fn () => ChannelAuthorizer::parse($raw)));
        }
        foreach (['session:', 'session:0', 'session:01', 'lobby:3', 'session:1,', 'map:1;DROP', 'SESSION:1', 'session:99999999999999999999'] as $raw) {
            self::assertSame(['channels' => 'invalid'], $this->fields(static fn () => ChannelAuthorizer::parse($raw)), $raw);
        }
        self::assertCount(4, ChannelAuthorizer::parse('session:1,session:2,map:3,map:4'));
        self::assertSame(['channels' => 'too_many'], $this->fields(static fn () => ChannelAuthorizer::parse('session:1,session:2,map:3,map:4,map:5')));
    }

    /**
     * @return array<string, mixed>
     */
    private function fields(\Closure $fn): array
    {
        try {
            $fn();
        } catch (ValidationException $e) {
            return $e->fields();
        }
        self::fail('ValidationException expected');
    }

    public function testSessionChannel(): void
    {
        ['channel' => $ch] = $this->world();
        self::assertSame(Audience::ROLE_GM, $this->outcome('Alice', [$ch]), 'GM');
        self::assertSame(Audience::ROLE_GM, $this->outcome('Carl', [$ch]), 'co-GM');
        self::assertSame(Audience::ROLE_PLAYER, $this->outcome('Bob', [$ch]), 'player of the session');
        self::assertSame(403, $this->outcome('Kim', [$ch]), 'kicked');
        self::assertSame(403, $this->outcome('Dan', [$ch]), 'member not in the session');
        self::assertSame(404, $this->outcome('Eve', [$ch]), 'non-member');
        self::assertSame(404, $this->outcome('Alice', ['session:999999']), 'unknown session');
    }

    public function testDisconnectedPlayerStillReads(): void
    {
        ['session' => $session, 'channel' => $ch] = $this->world();
        $this->db->execute('UPDATE ' . $this->db->t('session_players') . " SET `status` = 'disconnected' WHERE `session_id` = ?", [$session]);
        self::assertSame(Audience::ROLE_PLAYER, $this->outcome('Bob', [$ch]));
    }

    public function testMapChannel(): void
    {
        ['map' => $map, 'mapChannel' => $ch] = $this->world();
        self::assertSame(Audience::ROLE_GM, $this->outcome('Alice', [$ch]));
        self::assertSame(Audience::ROLE_GM, $this->outcome('Carl', [$ch]));
        self::assertSame(403, $this->outcome('Bob', [$ch]), 'player member');
        self::assertSame(404, $this->outcome('Eve', [$ch]));
        self::assertSame(404, $this->outcome('Alice', ['map:999999']));
        $this->db->execute('UPDATE ' . $this->db->t('maps') . ' SET `deleted_at` = UTC_TIMESTAMP() WHERE `id` = ?', [$map]);
        self::assertSame(404, $this->outcome('Alice', [$ch]), 'map in the trash');
        self::assertSame(404, $this->outcome('Bob', [$ch]));
    }

    public function testGameInTheTrashHidesEverything(): void
    {
        ['game' => $game, 'channel' => $ch, 'mapChannel' => $mapCh] = $this->world();
        $this->db->execute('UPDATE ' . $this->db->t('games') . ' SET `deleted_at` = UTC_TIMESTAMP() WHERE `id` = ?', [$game]);
        self::assertSame(404, $this->outcome('Alice', [$ch]));
        self::assertSame(404, $this->outcome('Bob', [$ch]));
        self::assertSame(404, $this->outcome('Alice', [$mapCh]));
    }

    public function testSeveralChannelsAndFirstRefusalWins(): void
    {
        ['channel' => $ch, 'mapChannel' => $mapCh] = $this->world();
        self::assertSame('gm,gm', $this->outcome('Alice', [$ch, $mapCh]));
        self::assertSame(403, $this->outcome('Bob', [$ch, $mapCh]), 'one channel refused => refused');
        self::assertSame(404, $this->outcome('Bob', ['session:999999', $mapCh]));
        $this->expectException(ValidationException::class);
        $this->authorizer()->authorize(1, ['session:1', 'session:2', 'session:3', 'session:4', 'session:5']);
    }

    public function testExceptionTypes(): void
    {
        ['channel' => $ch] = $this->world();
        try {
            $this->authorizer()->authorize($this->userId('Dan'), [$ch]);
            self::fail('403 expected');
        } catch (ForbiddenException $e) {
            self::assertSame('forbidden', $e->errorCode());
        }
        $this->expectException(NotFoundException::class);
        $this->authorizer()->authorize($this->userId('Eve'), [$ch]);
    }
}
