<?php

declare(strict_types=1);

namespace JDR\Tests\MapsP9b;

use JDR\Domain\Sessions\EventTypes;

/**
 * The filter by floor (P9a) and the filter by note (P9b) together: a note is shared per map, but
 * its pin only shows on the floor of the session.
 */
final class NotesAcrossFloorsTest extends MapsP9bTestCase
{
    /**
     * @return array<string, mixed>
     */
    private function playedWithUpperFloor(): array
    {
        $w = $this->bigScene(false);
        $this->setSettings($w, ['fog_strict' => false]);
        $w['screen'] = $this->screen($w['gm'], $w['session'], '198.18.9.2');
        $this->startSession($w);
        $this->opsOk($w['gm'], $w['big'], [
            ['type' => 'floor.add', 'floor' => ['uid' => 'up', 'name' => 'Étage', 'level' => 1]],
            self::addNote('n1', ['title' => 'La clé', 'body' => 'Sous la dalle.']),
            self::add(self::pin('p-up', 'up', 'n1')),
            self::add(self::pin('p-here', $w['bigFloor'], 'n1')),
        ]);

        return $w;
    }

    public function testASharedNoteShowsOnlyThePinOfTheCurrentFloor(): void
    {
        $w = $this->playedWithUpperFloor();
        $head = $this->head();

        $this->actOk($w['gm'], $w['session'], [['type' => 'note.share', 'note_uid' => 'n1', 'audience' => 'all']]);

        foreach ([$this->snap($w['bob'], $w['session']), $this->snap($w['screen'], $w['session'], true)] as $snapshot) {
            self::assertSame(['p-here'], self::objectUids($snapshot, 'p-'));
            self::assertSame(['n1'], array_column($snapshot['map']['notes'], 'uid'), 'the note itself is per map');
        }
        foreach ([
            $this->received($w['bob'], $w['channel'], $head),
            $this->receivedByScreen($w['screen'], $w['channel'], $head),
        ] as $events) {
            $encoded = json_encode(self::only($events, [EventTypes::MAP_OPS_PUBLIC]), JSON_THROW_ON_ERROR);
            self::assertStringContainsString('p-here', $encoded);
            self::assertStringNotContainsString('p-up', $encoded, 'the pin of another floor is not sent');
        }
    }

    public function testThePinFollowsWhenTheSessionChangesFloor(): void
    {
        $w = $this->playedWithUpperFloor();
        $this->actOk($w['gm'], $w['session'], [['type' => 'note.share', 'note_uid' => 'n1', 'audience' => 'all']]);

        $response = $w['gm']->post('/sessions/' . $w['session'] . '/change-map', ['map_id' => $w['big'], 'floor_id' => 'up']);
        self::assertSame(200, $response->status(), $response->body());

        foreach ([$this->snap($w['bob'], $w['session']), $this->snap($w['screen'], $w['session'], true)] as $snapshot) {
            self::assertSame(['p-up'], self::objectUids($snapshot, 'p-'));
        }
    }

    public function testAnUnsharedNoteHidesItsPinOnEveryFloor(): void
    {
        $w = $this->playedWithUpperFloor();

        $response = $w['gm']->post('/sessions/' . $w['session'] . '/change-map', ['map_id' => $w['big'], 'floor_id' => 'up']);
        self::assertSame(200, $response->status(), $response->body());

        $snapshot = $this->snap($w['bob'], $w['session']);
        self::assertSame([], self::objectUids($snapshot, 'p-'));
        self::assertSame([], $snapshot['map']['notes']);
    }
}
