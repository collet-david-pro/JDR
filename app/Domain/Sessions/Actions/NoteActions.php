<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions\Actions;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\ValidationException;
use JDR\Domain\Maps\MapNoteInput;
use JDR\Domain\Maps\MapNotes;
use JDR\Domain\Sessions\EventTypes;
use JDR\Domain\Sessions\FanoutBatch;
use JDR\Domain\Sessions\NoteFanout;
use JDR\Maps\ObjectRules;

/**
 * GM actions on the notes and secrets of the current map (etapes P09 D3, D4), checked and applied
 * in the transaction of the batch (a refusal rolls the whole batch back):
 * - note.share {note_uid, audience, users?}: same rules as the ops (actions.<i>.note_uid =
 *   not_found, .users = required | not_member); persisted on the map (no map revision, like
 *   door.toggle); note.shared (full version, gm), then NoteFanout for the recipients. Nothing
 *   happens when the audience does not change;
 * - note.show {note_uid}: note.read_aloud {title, body}, the audience does not change;
 * - secret.reveal / trap.reveal {uid}: the object must be of this type (actions.<i>.uid =
 *   not_found), then ActionHandlers::revealObject.
 */
final class NoteActions
{
    public function __construct(private MapNotes $notes, private NoteFanout $fanout)
    {
    }

    /**
     * @param array<string, mixed>  $a
     * @param array<string, string> $errors
     * @return array<string, mixed>
     */
    public static function parseShare(array $a, string $field, array &$errors): array
    {
        $uid = $a['note_uid'] ?? null;
        if (!ObjectRules::isUid($uid)) {
            $errors[$field . '.note_uid'] = $uid === null ? 'required' : 'invalid';
        }
        $audience = MapNoteInput::audience($a['audience'] ?? null, $field . '.audience', $errors);
        $users = $audience === MapNoteInput::AUDIENCE_PLAYERS ? MapNoteInput::users($a['users'] ?? null, $field . '.users', $errors) : [];

        return ['note_uid' => $uid, 'audience' => $audience, 'users' => $users];
    }

    /**
     * note.show {note_uid}: exclusive with title and body.
     *
     * @param array<string, mixed>  $a
     * @param array<string, string> $errors
     * @return array<string, mixed>
     */
    public static function parseShow(array $a, string $field, array &$errors): array
    {
        if (array_key_exists('title', $a) || array_key_exists('body', $a) || !ObjectRules::isUid($a['note_uid'])) {
            $errors[$field . '.note_uid'] = 'invalid';
        }

        return ['note_uid' => $a['note_uid']];
    }

    /**
     * @param array<string, mixed> $a
     * @return array<string, mixed>
     */
    public function share(ActionScene $s, FanoutBatch $f, array $a, int $index): array
    {
        $field = 'actions.' . $index;
        $row = $this->find($s, $a['note_uid'], $field);
        $users = $a['users'];
        sort($users);
        if ($users !== [] && array_diff($users, array_keys($this->notes->members($s->ctx->session->gameId, $users))) !== []) {
            throw new ValidationException('', [$field . '.users' => 'not_member']);
        }
        if ($row['audience'] !== $a['audience'] || $row['users'] !== $users) {
            $capture = $this->fanout->capture($s->map, [$row['uid']]);
            $this->notes->update($row['id'], ['audience' => $a['audience'], 'users' => $users] + $row);
            $f->gm(EventTypes::NOTE_SHARED, ['note' => MapNotes::editorForm($this->find($s, $row['uid'], $field))]);
            $this->fanout->emit($capture, [$f]);
        }

        return ['ok' => true, 'note_uid' => $row['uid'], 'audience' => $a['audience'], 'audience_users' => array_map('strval', $users)];
    }

    /**
     * @param array<string, mixed> $a
     * @return array<string, mixed>
     */
    public function show(ActionScene $s, FanoutBatch $f, array $a, int $index): array
    {
        $row = $this->find($s, $a['note_uid'], 'actions.' . $index);
        $f->always(EventTypes::NOTE_READ_ALOUD, ['title' => $row['title'], 'body' => $row['body']]);

        return ['ok' => true];
    }

    /**
     * Checks the object named by secret.reveal / trap.reveal.
     *
     * @param array<string, mixed> $a
     * @return array{uid: string}
     * @throws ValidationException
     */
    public function revealTarget(ActionScene $s, array $a, int $index): array
    {
        $expected = $a['type'] === 'secret.reveal' ? 'secret' : 'trap';
        if (($s->objects[$a['uid']]['object']['type'] ?? null) !== $expected) {
            throw new ValidationException('', ['actions.' . $index . '.uid' => 'not_found']);
        }

        return ['uid' => $a['uid']];
    }

    /**
     * @return array<string, mixed>
     * @throws ValidationException
     */
    private function find(ActionScene $s, string $uid, string $field): array
    {
        return $this->notes->byUids($s->map->id, [$uid])[$uid]
            ?? throw new ValidationException('', [$field . '.note_uid' => 'not_found']);
    }
}
