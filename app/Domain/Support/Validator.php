<?php

declare(strict_types=1);

namespace JDR\Domain\Support;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\ValidationException;
use JDR\Core\Request;
use JDR\Domain\Auth\Passwords;

/**
 * Input validation of a JSON body. Collects field errors (codes: required, invalid, too_short,
 * too_long, too_common, taken, mismatch, wrong_password => i18n validation.<code>) and throws
 * one 422 validation_failed with all of them.
 */
final class Validator
{
    /** @var array<string, string> */
    private array $errors = [];

    /**
     * @param array<array-key, mixed> $data
     */
    public function __construct(private array $data)
    {
    }

    public static function fromRequest(Request $request): self
    {
        $body = $request->parsedBody();

        return new self(is_array($body) ? $body : []);
    }

    public function has(string $key): bool
    {
        return array_key_exists($key, $this->data);
    }

    public function raw(string $key): mixed
    {
        return $this->data[$key] ?? null;
    }

    /**
     * Trimmed string (unless $trim is false). Absent/empty and required => "required";
     * absent and optional => null.
     */
    public function string(
        string $key,
        bool $required = true,
        int $min = 0,
        int $max = 65535,
        bool $trim = true,
    ): ?string {
        $value = $this->data[$key] ?? null;
        if ($value === null || $value === '') {
            if ($required) {
                $this->error($key, 'required');
            }

            return null;
        }
        if (!is_string($value)) {
            $this->error($key, 'invalid');

            return null;
        }
        if ($trim) {
            $value = trim($value);
            if ($value === '') {
                if ($required) {
                    $this->error($key, 'required');
                }

                return null;
            }
        }
        if (preg_match('//u', $value) !== 1 || str_contains($value, "\0")) {
            $this->error($key, 'invalid');

            return null;
        }
        $length = mb_strlen($value, 'UTF-8');
        if ($length < $min) {
            $this->error($key, 'too_short');

            return null;
        }
        if ($length > $max) {
            $this->error($key, 'too_long');

            return null;
        }

        return $value;
    }

    public function int(string $key, bool $required = true, int $min = PHP_INT_MIN, int $max = PHP_INT_MAX): ?int
    {
        $value = $this->data[$key] ?? null;
        if ($value === null) {
            if ($required) {
                $this->error($key, 'required');
            }

            return null;
        }
        if (is_float($value) && floor($value) === $value && abs($value) < 9.0E15) {
            $value = (int) $value;
        }
        if (!is_int($value) || $value < $min || $value > $max) {
            $this->error($key, 'invalid');

            return null;
        }

        return $value;
    }

    public function bool(string $key, bool $required = true): ?bool
    {
        $value = $this->data[$key] ?? null;
        if ($value === null) {
            if ($required) {
                $this->error($key, 'required');
            }

            return null;
        }
        if (!is_bool($value)) {
            $this->error($key, 'invalid');

            return null;
        }

        return $value;
    }

    /**
     * @param list<string> $allowed
     */
    public function in(string $key, array $allowed, bool $required = true): ?string
    {
        $value = $this->string($key, $required, 0, 100);
        if ($value !== null && !in_array($value, $allowed, true)) {
            $this->error($key, 'invalid');

            return null;
        }

        return $value;
    }

    /**
     * E-mail address, normalized to lower case.
     */
    public function email(string $key, bool $required = true): ?string
    {
        $value = $this->string($key, $required, 3, 191);
        if ($value === null) {
            return null;
        }
        $value = mb_strtolower($value, 'UTF-8');
        if (filter_var($value, FILTER_VALIDATE_EMAIL) === false || preg_match('/[\r\n<>"]/', $value) === 1) {
            $this->error($key, 'invalid');

            return null;
        }

        return $value;
    }

    /**
     * Username: ^[\p{L}\p{N}_ .-]{3,40}$ (projet.md 11.1).
     */
    public function username(string $key, bool $required = true): ?string
    {
        $value = $this->string($key, $required, 3, 40);
        if ($value === null) {
            return null;
        }
        if (preg_match('/^[\p{L}\p{N}_ .-]{3,40}$/u', $value) !== 1) {
            $this->error($key, 'invalid');

            return null;
        }

        return $value;
    }

    /**
     * Password (not trimmed) checked against the policy.
     */
    public function newPassword(string $key, bool $required = true): ?string
    {
        $value = $this->data[$key] ?? null;
        if ($value === null || $value === '') {
            if ($required) {
                $this->error($key, 'required');
            }

            return null;
        }
        if (!is_string($value) || preg_match('//u', $value) !== 1) {
            $this->error($key, 'invalid');

            return null;
        }
        $policy = Passwords::policyError($value);
        if ($policy !== null) {
            $this->error($key, $policy);

            return null;
        }

        return $value;
    }

    /**
     * Raw password to verify (any string up to 4096 bytes).
     */
    public function password(string $key, bool $required = true): ?string
    {
        $value = $this->data[$key] ?? null;
        if ($value === null || $value === '') {
            if ($required) {
                $this->error($key, 'required');
            }

            return null;
        }
        if (!is_string($value) || strlen($value) > 4096) {
            $this->error($key, 'invalid');

            return null;
        }

        return $value;
    }

    public function error(string $field, string $code): void
    {
        $this->errors[$field] ??= $code;
    }

    public function hasErrors(): bool
    {
        return $this->errors !== [];
    }

    /**
     * @return array<string, string>
     */
    public function errors(): array
    {
        return $this->errors;
    }

    /**
     * @throws ValidationException
     */
    public function validate(): void
    {
        if ($this->errors !== []) {
            throw new ValidationException('', $this->errors);
        }
    }
}
