<?php

declare(strict_types=1);

namespace JDR\Domain\Sessions;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\ValidationException;
use JDR\Domain\Users\User;

/**
 * Idempotence of the session writes (projet.md 9.1): a client_op_id (at most 40 characters)
 * already processed returns the stored response without running again. The response is stored
 * with the operation scope ("start:12"); the same id for another user or another operation is
 * refused (422 client_op_id already_used). The work, its events and the record are one
 * transaction.
 */
final class SessionOps
{
    public const MAX_LENGTH = 40;

    public function __construct(private SessionRepository $sessions)
    {
    }

    /**
     * client_op_id of a request body: null when absent.
     *
     * @throws ValidationException client_op_id: invalid
     */
    public static function clientOpId(mixed $body): ?string
    {
        if (!is_array($body) || !array_key_exists('client_op_id', $body) || $body['client_op_id'] === null) {
            return null;
        }
        $id = $body['client_op_id'];
        if (!is_string($id) || $id === '' || strlen($id) > self::MAX_LENGTH || preg_match('/^[\x21-\x7E]+$/D', $id) !== 1) {
            throw new ValidationException('', ['client_op_id' => 'invalid']);
        }

        return $id;
    }

    /**
     * @param callable(): mixed $work returns the JSON-able response data (null for a 204)
     */
    public function once(User $user, ?string $clientOpId, string $scope, callable $work): mixed
    {
        if ($clientOpId === null) {
            return $this->sessions->db()->transaction($work);
        }

        return $this->sessions->db()->transaction(function () use ($user, $clientOpId, $scope, $work): mixed {
            $row = $this->sessions->processed($clientOpId);
            if ($row !== null) {
                $stored = $row['response'];
                if ($row['user_id'] !== $user->id || !is_array($stored) || ($stored['scope'] ?? null) !== $scope) {
                    throw new ValidationException('', ['client_op_id' => 'already_used']);
                }

                return $stored['data'] ?? null;
            }
            $data = $work();
            try {
                $this->sessions->rememberProcessed($clientOpId, $user->id, ['scope' => $scope, 'data' => $data]);
            } catch (\PDOException $e) {
                if ((string) $e->getCode() !== '23000') {
                    throw $e;
                }
                throw new ValidationException('', ['client_op_id' => 'already_used']);
            }

            return $data;
        });
    }
}
