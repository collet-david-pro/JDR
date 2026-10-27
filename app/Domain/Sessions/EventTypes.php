<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions;

defined('JDR_BOOT') || exit;

/**
 * Every event type written by P6 (contract P6 "Catalogue des événements"): the anti-leak test
 * (tests/php/Security/LeakTest.php) fails when one of them is not covered. Add any new type here.
 */
final class EventTypes
{
    public const SESSION_STATE = 'session.state';
    public const SESSION_CODE = 'session.code';
    public const PLAYER_JOINED = 'player.joined';
    public const PLAYER_LEFT = 'player.left';
    public const PLAYER_READY = 'player.ready';
    public const PLAYER_KICKED = 'player.kicked';
    public const ASSIGNMENT_SET = 'assignment.set';
    public const MAP_CHANGED = 'map.changed';
    public const TOKEN_MOVED = 'maptoken.moved';
    public const TOKEN_ADDED = 'maptoken.added';
    public const TOKEN_UPDATED = 'maptoken.updated';
    public const TOKEN_REMOVED = 'maptoken.removed';
    public const DOOR_TOGGLED = 'door.toggled';
    public const OBJECT_REVEALED = 'object.revealed';
    public const FOG_UPDATED = 'fog.updated';
    public const LIGHT_CHANGED = 'light.changed';
    public const AMBIENT_CHANGED = 'ambient.changed';
    public const CAMERA_MOVED = 'camera.moved';
    public const NOTE_READ_ALOUD = 'note.read_aloud';
    public const MAP_OPS = 'map.ops';
    public const MAP_OPS_PUBLIC = 'map.ops.public';
    public const SERVER_NOTICE = 'server.notice';
    public const DISPLAY_PAIRED = 'display.paired';
    public const DISPLAY_UPDATED = 'display.updated';
    public const DISPLAY_REVOKED = 'display.revoked';

    public const ALL = [
        self::SESSION_STATE,
        self::SESSION_CODE,
        self::PLAYER_JOINED,
        self::PLAYER_LEFT,
        self::PLAYER_READY,
        self::PLAYER_KICKED,
        self::ASSIGNMENT_SET,
        self::MAP_CHANGED,
        self::TOKEN_MOVED,
        self::TOKEN_ADDED,
        self::TOKEN_UPDATED,
        self::TOKEN_REMOVED,
        self::DOOR_TOGGLED,
        self::OBJECT_REVEALED,
        self::FOG_UPDATED,
        self::LIGHT_CHANGED,
        self::AMBIENT_CHANGED,
        self::CAMERA_MOVED,
        self::NOTE_READ_ALOUD,
        self::MAP_OPS,
        self::MAP_OPS_PUBLIC,
        self::SERVER_NOTICE,
        self::DISPLAY_PAIRED,
        self::DISPLAY_UPDATED,
        self::DISPLAY_REVOKED,
    ];

    /** Types merged by D3 (the previous event of the same key, less than 1 s old, is deleted). */
    public const MERGED = [self::TOKEN_MOVED, self::CAMERA_MOVED];
}
