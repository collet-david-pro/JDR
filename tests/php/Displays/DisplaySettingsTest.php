<?php

declare(strict_types=1);

namespace JDR\Tests\Displays;

use PHPUnit\Framework\Attributes\DataProvider;

/**
 * Settings (D8): GM patch (every bound), the four keys of the screen, display.updated events.
 */
final class DisplaySettingsTest extends DisplaysTestCase
{
    /**
     * @return array<string, array{0: array<string, mixed>, 1: bool}> patch, accepted
     */
    public static function gmPatches(): array
    {
        $lock = ['x' => 1.5, 'y' => -2, 'zoom' => 2, 'floor_id' => null];

        return [
            'diagonal min' => [['diagonal_in' => 5], true],
            'diagonal max' => [['diagonal_in' => 300], true],
            'diagonal null' => [['diagonal_in' => null], true],
            'diagonal low' => [['diagonal_in' => 4.99], false],
            'diagonal high' => [['diagonal_in' => 300.01], false],
            'diagonal string' => [['diagonal_in' => '42'], false],
            'ppmm min' => [['px_per_mm' => 0.5], true],
            'ppmm max' => [['px_per_mm' => 50], true],
            'ppmm low' => [['px_per_mm' => 0.49], false],
            'ppmm high' => [['px_per_mm' => 50.1], false],
            'cell min' => [['mm_per_cell' => 5], true],
            'cell max' => [['mm_per_cell' => 100], true],
            'cell low' => [['mm_per_cell' => 4], false],
            'cell high' => [['mm_per_cell' => 101], false],
            'cell null' => [['mm_per_cell' => null], false],
            'rotation 90' => [['rotation' => 90], true],
            'rotation 270' => [['rotation' => 270], true],
            'rotation 45' => [['rotation' => 45], false],
            'rotation string' => [['rotation' => '90'], false],
            'mirror' => [['mirror' => true], true],
            'mirror int' => [['mirror' => 1], false],
            'tokens off' => [['show_tokens' => false], true],
            'tokens string' => [['show_tokens' => 'no'], false],
            'follow off' => [['follow_camera' => false], true],
            'follow null' => [['follow_camera' => null], false],
            'lock ok' => [['view_lock' => $lock], true],
            'lock null' => [['view_lock' => null], true],
            'lock zoom low' => [['view_lock' => ['zoom' => 0.09] + $lock], false],
            'lock zoom high' => [['view_lock' => ['zoom' => 8.1] + $lock], false],
            'lock x string' => [['view_lock' => ['x' => '1'] + $lock], false],
            'lock extra key' => [['view_lock' => $lock + ['z' => 1]], false],
            'lock missing zoom' => [['view_lock' => ['x' => 1, 'y' => 1]], false],
            'lock list' => [['view_lock' => [1, 2, 3]], false],
            'lock unknown floor' => [['view_lock' => ['floor_id' => '999999'] + $lock], false],
            'unknown key' => [['colour' => 'red'], false],
            'one bad among good' => [['mirror' => true, 'rotation' => 12], false],
        ];
    }

    /**
     * @param array<string, mixed> $patch
     */
    #[DataProvider('gmPatches')]
    public function testGmPatch(array $patch, bool $accepted): void
    {
        $w = $this->arena();
        $d = $this->makeDisplay($w['gm'], $w['session']);
        $before = $this->displayRow($d['id'])['settings'];
        $r = $w['gm']->patch('/displays/' . $d['id'], ['settings' => $patch]);
        if ($accepted) {
            self::assertSame(200, $r->status(), $r->body());
            foreach ($patch as $key => $value) {
                self::assertSame($value, self::data($r)['settings'][$key], $key);
            }
        } else {
            self::assertSame(422, $r->status(), $r->body());
            $fields = array_keys((array) $r->payload()['error']['fields']);
            self::assertNotSame([], $fields);
            foreach ($fields as $f) {
                self::assertStringStartsWith('settings.', $f);
            }
            self::assertSame($before, $this->displayRow($d['id'])['settings'], 'nothing stored');
        }
    }

    public function testPartialPatchRoundingFloorAndName(): void
    {
        $w = $this->arena();
        $d = $this->makeDisplay($w['gm'], $w['session']);
        $path = '/displays/' . $d['id'];
        $head = $this->head();
        $r = self::data($this->ok($w['gm']->patch($path, ['name' => ' Mur ', 'settings' => ['diagonal_in' => 42.12345, 'mirror' => true]])));
        self::assertSame('Mur', $r['name']);
        self::assertSame(42.123, $r['settings']['diagonal_in']);
        self::assertTrue($r['settings']['mirror']);
        self::assertSame(25, $r['settings']['mm_per_cell'], 'the rest is kept');
        self::assertSame(['display.updated/gm', 'display.updated/displays'], $this->kinds($head));

        $r = self::data($this->ok($w['gm']->patch($path, ['settings' => ['rotation' => 180]])));
        self::assertSame(42.123, $r['settings']['diagonal_in']);
        self::assertSame(180, $r['settings']['rotation']);

        $floor = $w['floor'];
        $r = self::data($this->ok($w['co']->patch($path, ['settings' => ['view_lock' => ['x' => 3.00049, 'y' => 4, 'zoom' => 1.5, 'floor_id' => $floor]]])));
        self::assertSame(['x' => 3, 'y' => 4, 'zoom' => 1.5, 'floor_id' => $floor], $r['settings']['view_lock']);

        self::assertSame(422, $w['gm']->patch($path, ['name' => ''])->status());
        self::assertSame(422, $w['gm']->patch($path, ['settings' => 'x'])->status());
        self::assertSame(422, $w['gm']->patch($path, ['settings' => [1]])->status());
        self::assertSame(404, $w['gm']->patch('/displays/999999', ['name' => 'x'])->status());
    }

    public function testEventAudiences(): void
    {
        $w = $this->arena();
        [$screen, $d] = $this->pairedScreen($w['gm'], $w['session']);
        $head = $this->head();
        $this->ok($w['gm']->patch('/displays/' . $d['id'], ['settings' => ['mirror' => true]]));
        $events = $this->events($head);
        self::assertSame(['gm', 'displays'], array_column($events, 'audience'));
        $gm = $events[0]['payload']['display'];
        $displays = $events[1]['payload']['display'];
        foreach (['user_agent', 'last_seen_at', 'paired_at', 'online', 'state', 'settings', 'name', 'id', 'session_id'] as $key) {
            self::assertArrayHasKey($key, $gm, $key);
        }
        self::assertSame('PHPUnit browser', $gm['user_agent']);
        self::assertEqualsCanonicalizing(['id', 'session_id', 'name', 'state', 'settings'], array_keys($displays));
        self::assertTrue($displays['settings']['mirror']);
        self::assertArrayNotHasKey('pairing', $gm);
        self::assertSame($w['channel'], $events[0]['channel']);
    }

    public function testDeviceMayOnlyChangeItsFourKeys(): void
    {
        $w = $this->arena();
        [$screen, $d] = $this->pairedScreen($w['gm'], $w['session']);
        $head = $this->head();
        $me = self::data($this->ok($screen->patch('/display/me?as=display', ['settings' => [
            'diagonal_in' => 55, 'px_per_mm' => 3.7, 'rotation' => 90, 'mirror' => true,
        ]])));
        self::assertSame(55, $me['settings']['diagonal_in']);
        self::assertSame(3.7, $me['settings']['px_per_mm']);
        self::assertSame(90, $me['settings']['rotation']);
        self::assertTrue($me['settings']['mirror']);
        self::assertSame(['display.updated/gm', 'display.updated/displays'], $this->kinds($head));
        self::assertNull($this->events($head)[0]['actor_user_id']);

        foreach (['mm_per_cell' => 30, 'show_tokens' => false, 'follow_camera' => false, 'view_lock' => null, 'nope' => 1] as $key => $value) {
            $r = $screen->patch('/display/me?as=display', ['settings' => [$key => $value]]);
            self::assertSame(422, $r->status(), $key);
            self::assertArrayHasKey('settings.' . $key, (array) $r->payload()['error']['fields']);
        }
        self::assertSame(422, $screen->patch('/display/me?as=display', ['settings' => ['rotation' => 10]])->status());
        self::assertSame(422, $screen->patch('/display/me?as=display', [])->status());
        $stored = json_decode((string) $this->displayRow($d['id'])['settings'], true);
        self::assertSame(25, $stored['mm_per_cell']);
        self::assertSame(90, $stored['rotation']);
    }
}
