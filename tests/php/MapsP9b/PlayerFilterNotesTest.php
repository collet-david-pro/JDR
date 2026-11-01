<?php

declare(strict_types=1);

namespace JDR\Tests\MapsP9b;

use JDR\Domain\Sessions\NoteVisibility;
use JDR\Maps\ObjectRulesNotes;
use JDR\Maps\PlayerFilter;
use PHPUnit\Framework\TestCase;

/**
 * PlayerFilter on the P9 objects: refusal by default, exact form of the walls.
 */
final class PlayerFilterNotesTest extends TestCase
{
    /**
     * @param array<string, mixed> $over
     * @return array<string, mixed>
     */
    private static function object(string $uid, string $type, array $geometry, array $props, array $over = []): array
    {
        return array_replace([
            'uid' => $uid, 'floor' => '1', 'type' => $type, 'layer' => 'props', 'geometry' => $geometry, 'props' => $props,
            'visibility' => 'hidden_until_revealed', 'locked' => false, 'sort_order' => 3, 'rev' => 2,
        ], $over);
    }

    public function testAWallFromAPassageHasExactlyTheFormOfAWallFromASecretDoor(): void
    {
        $passage = self::object('s1', 'secret', ['a' => [1, 2], 'b' => [3, 2]], ['kind' => 'passage', 'note' => 'n1'], ['layer' => 'walls']);
        $door = self::object('s1', 'door', ['a' => [1, 2], 'b' => [3, 2]], ['state' => 'closed', 'locked' => false, 'secret' => true, 'asset_open' => null, 'asset_closed' => null, 'swing' => 'a'], ['layer' => 'walls', 'visibility' => 'all']);

        $fromPassage = PlayerFilter::objects([$passage], [], [], ['n1'])[0];
        $fromDoor = PlayerFilter::objects([$door])[0];

        self::assertSame($fromDoor, $fromPassage);
        self::assertSame(['uid', 'floor', 'type', 'layer', 'geometry', 'props', 'visibility', 'locked', 'sort_order', 'rev'], array_keys($fromPassage));
        self::assertSame('wall', $fromPassage['type']);
        self::assertSame(PlayerFilter::SECRET_WALL_PROPS, $fromPassage['props']);
    }

    public function testARevealedPassageIsNoLongerAWall(): void
    {
        $passage = self::object('s1', 'secret', ['a' => [1, 2], 'b' => [3, 2]], ['kind' => 'passage', 'note' => 'n1'], ['layer' => 'walls']);

        $seen = PlayerFilter::objects([$passage], ['s1'])[0];
        self::assertSame('secret', $seen['type']);
        self::assertNull($seen['props']['note'], 'the note is not visible');
        self::assertSame('n1', PlayerFilter::objects([$passage], ['s1'], [], ['n1'])[0]['props']['note']);
    }

    public function testNothingIsSeenByDefault(): void
    {
        $polygon = ['polygon' => [['x' => 1, 'y' => 1], ['x' => 2, 'y' => 1], ['x' => 2, 'y' => 2]]];
        $objects = [
            self::object('z', 'zone', $polygon, ['kind' => 'description', 'note' => 'n1', 'show_on_enter' => true], ['layer' => 'gm', 'visibility' => 'gm']),
            self::object('t', 'trap', ['x' => 1, 'y' => 1], ['note' => 'n1', 'reveal_effect' => 'pulse']),
            self::object('r', 'secret', $polygon, ['kind' => 'room', 'note' => 'n1']),
            self::object('o', 'secret', $polygon, ['kind' => 'object', 'note' => null]),
            self::object('p', 'pin', ['x' => 1, 'y' => 1], ['icon' => 'place', 'color' => '#000000', 'note' => 'n1'], ['visibility' => 'all']),
            self::object('q', 'pin', ['x' => 1, 'y' => 1], ['icon' => 'place', 'color' => '#000000', 'note' => null], ['visibility' => 'gm']),
            self::object('h', 'pin', ['x' => 1, 'y' => 1], ['icon' => 'place', 'color' => '#000000', 'note' => null]),
        ];

        self::assertSame([], PlayerFilter::objects($objects));
    }

    public function testPinFollowsItsNoteWhateverItsVisibility(): void
    {
        $pin = static fn (?string $note, string $visibility): array => self::object('p', 'pin', ['x' => 1, 'y' => 1], ['icon' => 'info', 'color' => '#000000', 'note' => $note], ['visibility' => $visibility]);

        self::assertSame([], PlayerFilter::objects([$pin('n1', 'all')], ['p']), 'revealing does not help');
        $seen = PlayerFilter::objects([$pin('n1', 'gm')], [], [], ['n1'])[0];
        self::assertSame('n1', $seen['props']['note']);
        self::assertSame('all', $seen['visibility'], 'nothing says it was gm');
        self::assertCount(1, PlayerFilter::objects([$pin(null, 'all')]));
        self::assertSame([], PlayerFilter::objects([$pin(null, 'gm')], ['p'], [], ['n1']));
        self::assertSame([], PlayerFilter::objects([$pin(null, 'hidden_until_revealed')]));
        self::assertCount(1, PlayerFilter::objects([$pin(null, 'hidden_until_revealed')], ['p']));
    }

    public function testRevealedObjectsHideANoteTheReaderCannotRead(): void
    {
        $trap = self::object('t', 'trap', ['x' => 1, 'y' => 1], ['note' => 'n1', 'reveal_effect' => 'none']);

        self::assertNull(PlayerFilter::objects([$trap], ['t'], [], ['n2'])[0]['props']['note']);
        self::assertSame('n1', PlayerFilter::objects([$trap], ['t'], [], ['n1'])[0]['props']['note']);
    }

    public function testVisibilityOfNotes(): void
    {
        $v = new NoteVisibility(['all' => ['audience' => 'all', 'users' => []], 'some' => ['audience' => 'players', 'users' => [7 => true]]]);

        self::assertSame(['all', 'some'], $v->uidsFor(7));
        self::assertSame(['all'], $v->uidsFor(8));
        self::assertSame(['all'], $v->uidsFor(0), 'the table only sees "all"');
        self::assertFalse($v->visibleTo('unknown', 7));
    }

    public function testPointInPolygon(): void
    {
        $square = [['x' => 1, 'y' => 1], ['x' => 3, 'y' => 1], ['x' => 3, 'y' => 3], ['x' => 1, 'y' => 3]];

        self::assertTrue(ObjectRulesNotes::contains($square, 2.0, 2.0));
        self::assertTrue(ObjectRulesNotes::contains($square, 1.0, 2.0), 'an edge is inside');
        self::assertFalse(ObjectRulesNotes::contains($square, 0.5, 2.0));
        self::assertFalse(ObjectRulesNotes::contains($square, 3.5, 3.5));
    }
}
