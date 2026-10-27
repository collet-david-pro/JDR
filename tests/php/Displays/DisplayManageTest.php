<?php

declare(strict_types=1);

namespace JDR\Tests\Displays;

/**
 * GM side: creation, limit, new code, revocation, revocation of every screen when the session ends.
 */
final class DisplayManageTest extends DisplaysTestCase
{
    public function testCreationByGmAndCoGm(): void
    {
        $w = $this->arena();
        $head = $this->head();
        $d = $this->makeDisplay($w['gm'], $w['session'], '  Table  ');
        self::assertSame('Table', $d['name']);
        self::assertSame('pending', $d['state']);
        self::assertFalse($d['online']);
        self::assertSame($w['session'], $d['session_id']);
        self::assertSame(['diagonal_in' => null, 'px_per_mm' => null, 'mm_per_cell' => 25, 'rotation' => 0, 'mirror' => false,
            'show_tokens' => true, 'follow_camera' => true, 'view_lock' => null], $d['settings']);
        self::assertMatchesRegularExpression('/^\d{6}$/D', $d['pairing']['code']);
        self::assertSame('http://jdr.test/display?c=' . $d['pairing']['code'], $d['pairing']['url']);
        self::assertMatchesRegularExpression('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/D', $d['pairing']['expires_at']);
        self::assertSame(['display.updated/gm'], $this->kinds($head), 'creation: nothing for the screens');

        $row = $this->displayRow($d['id']);
        self::assertNotNull($row);
        self::assertNotSame($d['pairing']['code'], $row['pairing_code_hash']);
        self::assertStringNotContainsString($d['pairing']['code'], (string) json_encode($row));
        $delta = strtotime((string) $row['pairing_expires_at'] . ' UTC') - time();
        self::assertEqualsWithDelta(600, $delta, 10);

        $co = $this->makeDisplay($w['co'], $w['session'], 'Mur');
        self::assertNotSame($d['pairing']['code'], $co['pairing']['code']);

        $list = self::data($this->ok($w['gm']->get('/sessions/' . $w['session'] . '/displays')));
        self::assertSame([$d['id'], $co['id']], array_column($list['displays'], 'id'));
        self::assertArrayNotHasKey('reusable', $list);
        self::assertNull($list['displays'][0]['pairing']);
    }

    public function testCreationRightsAndValidation(): void
    {
        $w = $this->arena();
        $path = '/sessions/' . $w['session'] . '/displays';
        self::assertSame(403, $w['bob']->post($path, ['name' => 'x'])->status());
        self::assertSame(403, $w['dan']->post($path, ['name' => 'x'])->status());
        self::assertSame(404, $w['eve']->post($path, ['name' => 'x'])->status());
        self::assertSame(422, $w['gm']->post($path, [])->status());
        self::assertSame(422, $w['gm']->post($path, ['name' => '   '])->status());
        self::assertSame(422, $w['gm']->post($path, ['name' => str_repeat('a', 61)])->status());
        self::assertSame(201, $w['gm']->post($path, ['name' => str_repeat('é', 60)])->status());
        self::assertSame(0, $this->rows('session_displays', '`name` = ?', ['x']));
    }

    public function testEndedSessionAndLimit(): void
    {
        $w = $this->arena();
        $path = '/sessions/' . $w['session'] . '/displays';
        for ($i = 1; $i <= 8; $i++) {
            $this->makeDisplay($w['gm'], $w['session'], 'E' . $i);
        }
        $r = $w['gm']->post($path, ['name' => 'E9']);
        self::assertSame(409, $r->status());
        self::assertSame('display_limit', $this->errorCode($r));
        self::assertSame(8, $this->rows('session_displays'));

        $this->setState($w['session'], 'ended');
        $r = $w['gm']->post($path, ['name' => 'late']);
        self::assertSame(409, $r->status());
        self::assertSame('invalid_transition', $this->errorCode($r));
    }

    public function testRegenerateCode(): void
    {
        $w = $this->arena();
        $d = $this->makeDisplay($w['gm'], $w['session']);
        $old = $d['pairing']['code'];
        $head = $this->head();
        $new = self::data($this->ok($w['co']->post('/displays/' . $d['id'] . '/regenerate-code')));
        self::assertSame('pending', $new['state']);
        self::assertMatchesRegularExpression('/^\d{6}$/D', $new['pairing']['code']);
        self::assertSame([], $this->kinds($head));

        $screen = $this->screen();
        if ($new['pairing']['code'] !== $old) {
            $r = $screen->post('/display/pair', ['code' => $old]);
            self::assertSame(422, $r->status());
            self::assertSame('display_code_invalid', $this->errorCode($r));
        }
        $this->ok($screen->post('/display/pair', ['code' => $new['pairing']['code']]));

        $r = $w['gm']->post('/displays/' . $d['id'] . '/regenerate-code');
        self::assertSame(409, $r->status());
        self::assertSame('display_not_pending', $this->errorCode($r));
        self::assertSame(404, $w['gm']->post('/displays/999999/regenerate-code')->status());
    }

    public function testRevocationByGm(): void
    {
        $w = $this->arena();
        [$screen, $d] = $this->pairedScreen($w['gm'], $w['session']);
        $this->ok($screen->get('/display/me?as=display'));
        $head = $this->head();
        $this->ok($w['co']->delete('/displays/' . $d['id']), 204);
        self::assertNull($this->displayRow($d['id']));
        self::assertSame(['display.revoked/gm', 'display.revoked/displays'], $this->kinds($head));
        foreach ($this->events($head) as $e) {
            self::assertSame(['display_id' => $d['id']], \JDR\Core\Ids::stringify($e['payload']));
        }
        $r = $screen->get('/display/me?as=display');
        self::assertSame(401, $r->status());
        self::assertSame('display_unpaired', $this->errorCode($r));
        self::assertSame(404, $w['gm']->delete('/displays/' . $d['id'])->status());
    }

    public function testEndingTheSessionRevokesEveryScreen(): void
    {
        $w = $this->arena();
        [$screen, $d] = $this->pairedScreen($w['gm'], $w['session']);
        $pending = $this->makeDisplay($w['gm'], $w['session'], 'Pas appairé');
        $this->ok($screen->get('/display/me?as=display'));
        $head = $this->head();
        $this->ok($w['gm']->post('/sessions/' . $w['session'] . '/end', ['client_op_id' => 'end-1']));

        self::assertSame(0, $this->rows('session_displays'));
        self::assertNull($this->displayRow($d['id']));
        self::assertNull($this->displayRow($pending['id']));
        $kinds = $this->kinds($head);
        $revoked = array_values(array_filter($kinds, static fn (string $k): bool => str_starts_with($k, 'display.revoked')));
        self::assertSame(
            ['display.revoked/gm', 'display.revoked/displays', 'display.revoked/gm', 'display.revoked/displays'],
            $revoked,
        );
        $lastState = max(array_keys(array_filter($kinds, static fn (string $k): bool => str_starts_with($k, 'session.state'))));
        self::assertGreaterThan($lastState, array_search('display.revoked/gm', $kinds, true), 'session.state first');

        $r = $screen->get('/display/me?as=display');
        self::assertSame(401, $r->status());
        self::assertSame('display_unpaired', $this->errorCode($r));

        $list = self::data($this->ok($w['gm']->get('/sessions/' . $w['session'] . '/displays')));
        self::assertSame(['displays' => []], $list);

        // Replayed end (same client_op_id): no second event.
        $again = $this->head();
        $this->ok($w['gm']->post('/sessions/' . $w['session'] . '/end', ['client_op_id' => 'end-1']));
        self::assertSame([], $this->kinds($again));
    }

    public function testAttachRouteIsGone(): void
    {
        $w = $this->arena();
        [, $d] = $this->pairedScreen($w['gm'], $w['session']);
        $r = $w['gm']->post('/sessions/' . $w['session'] . '/displays/' . $d['id'] . '/attach');
        self::assertContains($r->status(), [404, 405]);
    }

    public function testMigrationDeletesScreensOfEndedSessionsOnly(): void
    {
        $w = $this->arena();
        [, $d] = $this->pairedScreen($w['gm'], $w['session']);
        $sessions = $this->db->t('play_sessions');
        $this->db->execute("UPDATE $sessions SET `state` = 'ended' WHERE `id` = ?", [(int) $w['session']]);
        $sql = (string) preg_replace('/^\s*--.*$/m', '', (string) file_get_contents(self::migrationsDir() . '/0004_revoke_ended_displays.sql'));
        $sql = trim(str_replace(
            ['`{{prefix}}session_displays`', '`{{prefix}}play_sessions`'],
            [$this->db->t('session_displays'), $sessions],
            $sql,
        ));
        $this->db->execute($sql);
        self::assertNull($this->displayRow($d['id']));

        $this->db->execute("UPDATE $sessions SET `state` = 'lobby' WHERE `id` = ?", [(int) $w['session']]);
        [, $d2] = $this->pairedScreen($w['gm'], $w['session']);
        $this->db->execute("UPDATE $sessions SET `state` = 'running' WHERE `id` = ?", [(int) $w['session']]);
        $this->db->execute($sql);
        self::assertNotNull($this->displayRow($d2['id']), 'a running session keeps its screens');
    }
}
