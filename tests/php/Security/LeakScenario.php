<?php

declare(strict_types=1);

namespace JDR\Tests\Security;

/**
 * The session played by LeakTest, through the API (server.notice excepted: it has no endpoint,
 * EventStore::serverNotice() is called), and what players A (Bob) and B (Dan) must never get.
 *
 * Map 200 x 200 (SessionsTestCase::bigScene): Bob's elf near (5, 5) -> block 0:0; Dan's dwarf
 * moved to (100, 100) -> blocks 2..3:2..3; far wall / goblin / tile in blocks 4:4 and 5:5.
 * Hidden content: walls on the gm layer, visibility gm, a hidden_until_revealed wall never
 * revealed (hidden-keep) and one revealed in the middle (hidden-vis), a secret door, hidden
 * tokens (t-dragon, t-shade, t-lurk) and one revealed (t-ghost), a light on the gm layer, a
 * visible light following the hidden dragon.
 */
trait LeakScenario
{
    /**
     * @param array<string, bool> $settings
     * @return array<string, mixed> world + revealed_at (head before the reveals) + explored_at
     *                              (head before Bob explores block 0:0)
     */
    protected function playWholeSession(array $settings): array
    {
        $w = $this->bigScene(false);
        $gm = $w['gm'];
        $f = $w['bigFloor'];
        $s = $w['session'];
        $base = '/sessions/' . $s;
        $spectre = $this->newToken($gm, $w['game'], ['name' => 'Spectre', 'kind' => 'monster']);
        $shade = $this->newToken($gm, $w['game'], ['name' => 'Ombre', 'kind' => 'monster']);
        $goblinDef = (string) $this->db->fetchValue('SELECT `token_id` FROM ' . $this->db->t('map_tokens') . " WHERE `uid` = 't-goblin'");
        $dragonDef = (string) $this->db->fetchValue('SELECT `token_id` FROM ' . $this->db->t('map_tokens') . " WHERE `uid` = 't-dragon'");
        $light = static fn (string $uid, float $x, float $y, array $over = []): array => array_replace([
            'uid' => $uid, 'floor' => $f, 'type' => 'light', 'layer' => 'lighting', 'geometry' => ['x' => $x, 'y' => $y],
            'props' => ['radius' => 2, 'dim_radius' => 3, 'color' => '#ffcc88', 'intensity' => 1,
                'flicker' => ['type' => 'none', 'amp' => 0, 'speed' => 1], 'cone' => null, 'enabled' => true, 'follows_token' => null],
            'visibility' => 'all', 'locked' => false, 'sort_order' => 0,
        ], $over);
        $this->fill($gm, $w['big'], [
            self::wallObject('hidden-keep', $f, [[2, 9], [3, 9]], ['visibility' => 'hidden_until_revealed']),
            $light('gm-light', 6, 9, ['layer' => 'gm']),
            $light('torch', 7, 9, ['props' => ['radius' => 2, 'dim_radius' => 3, 'color' => '#ffcc88', 'intensity' => 1,
                'flicker' => ['type' => 'none', 'amp' => 0, 'speed' => 1], 'cone' => null, 'enabled' => true, 'follows_token' => 't-dragon']]),
            self::wallObject('wall-dan', $f, [[100, 95], [102, 95]]),
        ], [
            self::placedToken('t-ghost', $f, (string) $spectre['id'], 6, 8, ['hidden' => true]),
            self::placedToken('t-shade', $f, (string) $shade['id'], 4, 8, ['hidden' => true]),
            self::placedToken('t-dan-near', $f, $goblinDef, 101, 103),
        ]);
        $this->opsOk($gm, $w['big'], [['type' => 'maptoken.update', 'uid' => 't-dwarf', 'rev' => 1, 'patch' => ['x' => 100, 'y' => 100]]]);
        $this->setSettings($w, $settings);
        $this->startSession($w);

        $this->ok($w['bob']->post($base . '/ready', ['ready' => true]), 204);
        $this->ok($gm->post($base . '/regenerate-code'));
        $this->actOk($w['bob'], $s, [self::move('t-elf', 6, 6)]);
        $this->actOk($w['dan'], $s, [self::move('t-dwarf', 101, 100)]);
        $this->actOk($gm, $s, [
            self::move('t-goblin', 9, 5), self::move('t-dragon', 7, 6), self::move('t-goblin-far', 171, 171), self::move('t-dan-near', 102, 103),
            ['type' => 'door.toggle', 'uid' => 'door-plain'], ['type' => 'door.toggle', 'uid' => 'door-secret'],
            ['type' => 'light.toggle', 'uid' => 'torch'], ['type' => 'light.toggle', 'uid' => 'gm-light'],
            ['type' => 'camera.set', 'x' => 10, 'y' => 10, 'zoom' => 1], ['type' => 'ambient.set', 'ambient' => ['darkness' => 0.5]],
            ['type' => 'note.show', 'title' => 'Écho', 'body' => 'Des pas.'],
            ['type' => 'fog.reveal', 'floor' => $f, 'chunks' => [[5, 0, self::b64(self::fogBits(5, 0, 170, 4, 180, 10))]]],
        ]);
        // D10: editor ops on the played map.
        $this->opsOk($gm, $w['big'], [
            ['type' => 'object.add', 'object' => self::wallObject('wall-new', $f, [[3, 12], [4, 12]])],
            ['type' => 'object.add', 'object' => self::wallObject('gm-new', $f, [[3, 13], [4, 13]], ['layer' => 'gm'])],
            self::tiles($f, 'ground', [[4, 4, 1], [150, 151, 2]]),
            ['type' => 'maptoken.add', 'token' => self::placedToken('t-rat', $f, $goblinDef, 7, 12)],
            ['type' => 'maptoken.add', 'token' => self::placedToken('t-lurk', $f, $dragonDef, 8, 12, ['hidden' => true])],
        ]);
        $this->opsOk($gm, $w['big'], [['type' => 'maptoken.update', 'uid' => 't-rat', 'rev' => 1, 'patch' => ['x' => 8]]]);
        $this->opsOk($gm, $w['big'], [['type' => 'maptoken.remove', 'uid' => 't-rat'], ['type' => 'maptoken.update', 'uid' => 't-lurk', 'rev' => 1, 'patch' => ['x' => 9]]]);

        $w['revealed_at'] = PHP_INT_MAX;
        $w['explored_at'] = PHP_INT_MAX;
        $this->inspectReads($w, $this->rules($w, $settings), 'middle');

        $w['revealed_at'] = $this->head();
        $this->actOk($gm, $s, [['type' => 'reveal', 'kind' => 'object', 'uid' => 'hidden-vis'], ['type' => 'reveal', 'kind' => 'token', 'uid' => 't-ghost']]);
        $this->ok($gm->post($base . '/pause'));
        $this->actOk($gm, $s, [self::move('t-goblin', 10, 5), ['type' => 'note.show', 'title' => 'Pause', 'body' => '']]);
        $this->ok($gm->post($base . '/resume'));
        $w['explored_at'] = $this->head();
        $this->actOk($w['bob'], $s, [['type' => 'fog.reveal', 'floor' => $f, 'chunks' => [[0, 0, self::b64(str_repeat("\xff", 2048))]]]]);
        $this->store()->serverNotice('maintenance', 'Redémarrage');

        return $w;
    }

    /**
     * Forbidden needles [players, uid / name, until event id] and blocks [players, cx, cy, until].
     *
     * @param array<string, mixed> $w
     * @param array<string, bool>  $settings
     * @return array<string, mixed>
     */
    protected function rules(array $w, array $settings): array
    {
        $both = ['bob', 'dan'];
        $ever = PHP_INT_MAX;
        $needles = [];
        foreach (['gm-layer', 'gm-vis', 'hidden-keep', 'gm-light', 'gm-new', 't-dragon', 't-shade', 't-lurk', 'Dragon', 'Ombre'] as $uid) {
            $needles[] = [$both, $uid, $ever];
        }
        foreach (['hidden-vis', 't-ghost', 'Spectre'] as $uid) {
            $needles[] = [$both, $uid, $w['revealed_at']];
        }
        $blocks = [];
        $assets = [];
        if ($settings['fog_strict']) {
            foreach (['wall-far', 't-goblin-far', 'wall-dan', 't-dan-near', 't-dwarf', 'Nain'] as $uid) {
                $needles[] = [['bob'], $uid, $ever];
            }
            foreach (['wall-far', 't-goblin-far'] as $uid) {
                $needles[] = [['dan'], $uid, $ever];
            }
            foreach (['wall-near', 'door-plain', 'door-secret', 'torch', 'wall-new', 't-rat', 't-elf', 't-goblin', 'Elfe'] as $uid) {
                $needles[] = [['dan'], $uid, $w['explored_at']];
            }
            foreach ([[2, 2], [2, 3], [3, 2], [3, 3]] as [$cx, $cy]) {
                $blocks[] = [['bob'], $cx, $cy, $ever];
            }
            $blocks[] = [$both, 4, 4, $ever];
            $blocks[] = [$both, 5, 5, $ever];
            $blocks[] = [['dan'], 0, 0, $w['explored_at']];
            $assets['bob'] = [$w['b']['id']];
        }
        if (!$settings['players_see_other_pcs']) {
            $needles[] = [['bob'], 't-dwarf', $ever];
            $needles[] = [['bob'], 'Nain', $ever];
            $needles[] = [['dan'], 't-elf', $ever];
            $needles[] = [['dan'], 'Elfe', $ever];
            $assets['dan'] = [$w['img']['id']];
        }

        return ['needles' => $needles, 'blocks' => $blocks, 'assets' => $assets, 'floor' => (int) $w['bigFloor'], 'revealed_at' => $w['revealed_at']];
    }
}
