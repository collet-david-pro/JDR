<?php

declare(strict_types=1);

namespace JDR\Tests\Sessions;

use JDR\Realtime\Audience;
use JDR\Realtime\EventReader;

/**
 * Audiences of the events written by P6b (catalogue, rows "b") and what each reader receives.
 */
final class SessionEventsAudienceTest extends SessionsTestCase
{
    private const AUDIENCES = [
        'session.state' => Audience::ALL,
        'session.code' => Audience::GM,
        'player.joined' => Audience::PLAYERS,
        'player.left' => Audience::PLAYERS,
        'player.ready' => Audience::PLAYERS,
        'player.kicked' => Audience::USER,
        'assignment.set' => Audience::ALL,
        'map.changed' => Audience::ALL,
    ];

    /**
     * Plays a whole session; returns the world.
     *
     * @return array<string, mixed>
     */
    private function play(): array
    {
        $w = $this->arena(false);
        $gm = $w['gm'];
        $base = '/sessions/' . $w['session'];
        $other = $this->newMap($gm, $w['game'], ['name' => 'Donjon']);
        $token = $this->newToken($gm, $w['game'], ['name' => 'Elfe', 'kind' => 'pc']);
        $this->ok($gm->put($base . '/assignments/' . $token['id'], ['user_id' => (string) $this->userId('Bob')]));
        $this->ok($w['bob']->post($base . '/ready', ['ready' => true]), 204);
        $this->ok($gm->post($base . '/change-map', ['map_id' => $other['id']]));
        $this->ok($gm->post($base . '/start'));
        $this->ok($gm->post($base . '/pause'));
        $this->ok($gm->post($base . '/resume'));
        $this->ok($gm->post($base . '/regenerate-code'));
        $this->ok($gm->patch($base, ['pause_screen' => ['text' => 'Pause']]));
        $this->ok($gm->post($base . '/kick', ['user_id' => (string) $this->userId('Kim')]), 204);
        $this->ok($w['bob']->post($base . '/leave'), 204);
        $this->ok($gm->post($base . '/end'));

        return $w;
    }

    public function testEveryEventHasItsAudienceAndChannel(): void
    {
        $w = $this->play();
        $events = $this->events();
        $types = array_values(array_unique(array_column($events, 'type')));
        sort($types);
        $expected = array_keys(self::AUDIENCES);
        sort($expected);
        self::assertSame($expected, $types, 'every event of the rows "b" is written, and only those');
        foreach ($events as $event) {
            self::assertSame(self::AUDIENCES[$event['type']], $event['audience'], $event['type']);
            self::assertSame($w['channel'], $event['channel'], $event['type']);
            if ($event['audience'] === Audience::USER) {
                self::assertSame($this->userId('Kim'), (int) $event['audience_user_id']);
            } else {
                self::assertNull($event['audience_user_id']);
            }
            self::assertSame(0, (int) $event['ephemeral']);
        }
    }

    public function testWhatEachReaderReceives(): void
    {
        $w = $this->play();
        $reader = $this->app->container()->get(EventReader::class);
        $channel = $w['channel'];
        $types = static fn (iterable $events): array => array_map(static fn ($e): string => $e->type, [...$events]);

        $gm = $reader->read(self::sub($this->userId('Alice'), [$channel => Audience::ROLE_GM]), 0)->events;
        self::assertContains('session.code', $types($gm));
        self::assertContains('player.kicked', $types($gm));

        $bob = $reader->read(self::sub($this->userId('Bob'), [$channel => Audience::ROLE_PLAYER]), 0)->events;
        self::assertNotContains('session.code', $types($bob));
        self::assertNotContains('player.kicked', $types($bob), 'the kick of Kim is for Kim');
        self::assertContains('player.left', $types($bob));
        self::assertContains('assignment.set', $types($bob));

        $kim = $reader->read(self::sub($this->userId('Kim'), [$channel => Audience::ROLE_PLAYER]), 0)->events;
        self::assertContains('player.kicked', $types($kim));
        self::assertNotContains('session.code', $types($kim));

        $screen = $reader->read(self::sub(null, [$channel => Audience::ROLE_DISPLAY]), 0)->events;
        self::assertEqualsCanonicalizing(['session.state', 'assignment.set', 'map.changed'], array_values(array_unique($types($screen))));

        // The code never travels outside the "gm" audience.
        foreach ([$bob, $kim, $screen] as $list) {
            self::assertStringNotContainsString($w['code'], json_encode(array_map(static fn ($e) => $e->toArray(), [...$list])));
        }
        $newCode = (string) $this->db->fetchValue('SELECT `code` FROM ' . $this->db->t('play_sessions'));
        foreach ($this->events() as $event) {
            if ($event['audience'] !== Audience::GM) {
                self::assertStringNotContainsString($newCode, json_encode($event['payload']), $event['type']);
                self::assertArrayNotHasKey('code', $event['payload'], $event['type']);
            }
        }
    }

    public function testNoEventWithoutItsChange(): void
    {
        $w = $this->arena();
        $before = $this->head();
        // Refused and failed writes leave no event behind (same transaction as the change).
        self::assertSame(409, $w['gm']->post('/sessions/' . $w['session'] . '/pause')->status());
        self::assertSame(403, $w['bob']->post('/sessions/' . $w['session'] . '/start')->status());
        self::assertSame(422, $w['gm']->post('/sessions/' . $w['session'] . '/kick', ['user_id' => (string) $this->userId('Dan')])->status());
        self::assertSame(422, $w['gm']->post('/sessions/' . $w['session'] . '/change-map', ['map_id' => '99999'])->status());
        self::assertSame(422, $w['gm']->post('/sessions/' . $w['session'] . '/start', ['client_op_id' => str_repeat('x', 41)])->status());
        self::assertSame($before, $this->head());
        self::assertSame('lobby', $this->state($w['session']));
    }
}
