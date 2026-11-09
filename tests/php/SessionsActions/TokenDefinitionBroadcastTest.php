<?php

declare(strict_types=1);

namespace JDR\Tests\SessionsActions;

/**
 * PATCH /tokens/{id} of a token placed on the current map of an open session (imposed GM image,
 * name...): every client reloads its snapshot (map.ops.public {reload: true}); no definition in
 * the payload; paused: the GM only; a token absent from the map: nothing.
 */
final class TokenDefinitionBroadcastTest extends ActionsTestCase
{
    public function testRunningSessionReloadsEveryClient(): void
    {
        $w = $this->bigScene();
        $head = $this->head();
        $this->ok($w['gm']->patch('/tokens/' . $w['elf']['id'], ['gm_image_forced' => true]));
        self::assertContains('map.ops.public/gm', $this->kinds($head));
        foreach ($this->events($head) as $event) {
            self::assertSame('map.ops.public', $event['type']);
            self::assertTrue($event['payload']['reload']);
            self::assertSame([], $event['payload']['objects']['upsert']);
            self::assertStringNotContainsString('Elfe', json_encode($event['payload']));
        }
        foreach (['bob', 'dan'] as $who) {
            self::assertSame(['map.ops.public'], $this->receivedTypes($w[$who], $w['channel'], $head), $who);
        }
    }

    public function testPausedSessionReloadsTheGmOnly(): void
    {
        $w = $this->bigScene();
        $this->ok($w['gm']->post('/sessions/' . $w['session'] . '/pause'));
        $head = $this->head();
        $this->ok($w['gm']->patch('/tokens/' . $w['elf']['id'], ['name' => 'Elfe noire']));
        self::assertSame(['map.ops.public/gm'], $this->kinds($head));
    }

    public function testTokenAbsentFromTheMapWritesNothing(): void
    {
        $w = $this->bigScene();
        $other = $this->newToken($w['gm'], $w['game'], ['name' => 'Absent', 'kind' => 'monster']);
        $head = $this->head();
        $this->ok($w['gm']->patch('/tokens/' . $other['id'], ['gm_image_forced' => true]));
        self::assertSame($head, $this->head());
    }
}
