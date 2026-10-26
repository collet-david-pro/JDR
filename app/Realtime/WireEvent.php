<?php

declare(strict_types=1);

namespace JDR\Realtime;

defined('JDR_BOOT') || exit;

use JDR\Core\Response;
use JDR\Domain\Support\Dates;

/**
 * An event as sent to the clients (contract P6a):
 * {"id":"1234","channel":"session:12","type":"maptoken.moved","payload":{…},"actor":"5"|null,
 *  "client_op_id":"…"|null,"at":"2026-…Z"}. Audience columns never leave the server.
 */
final class WireEvent
{
    public function __construct(
        public readonly int $id,
        public readonly string $channel,
        public readonly string $type,
        public readonly string $payloadJson,
        public readonly ?int $actorId,
        public readonly ?string $clientOpId,
        public readonly ?string $at,
    ) {
    }

    /**
     * @param array<string, mixed> $row columns of the events table
     */
    public static function fromRow(array $row): self
    {
        return new self(
            (int) $row['id'],
            (string) $row['channel'],
            (string) $row['type'],
            (string) $row['payload'],
            $row['actor_user_id'] === null ? null : (int) $row['actor_user_id'],
            $row['client_op_id'] === null ? null : (string) $row['client_op_id'],
            Dates::iso($row['created_at']),
        );
    }

    /**
     * Payload decoded with objects kept as objects ({} stays {}).
     */
    public function payload(): mixed
    {
        $value = json_decode($this->payloadJson, false);

        return $value ?? new \stdClass();
    }

    /**
     * @return array{id: string, channel: string, type: string, payload: mixed, actor: ?string, client_op_id: ?string, at: ?string}
     */
    public function toArray(): array
    {
        return [
            'id' => (string) $this->id,
            'channel' => $this->channel,
            'type' => $this->type,
            'payload' => $this->payload(),
            'actor' => $this->actorId === null ? null : (string) $this->actorId,
            'client_op_id' => $this->clientOpId,
            'at' => $this->at,
        ];
    }

    /**
     * One-line JSON (SSE "data:" line).
     */
    public function toJson(): string
    {
        return json_encode($this->toArray(), Response::JSON_FLAGS);
    }
}
