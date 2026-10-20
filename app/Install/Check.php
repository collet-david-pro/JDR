<?php

declare(strict_types=1);

namespace JDR\Install;

defined('JDR_BOOT') || exit;

/**
 * One line of a check table: green (ok), orange (warn) or red (error).
 * $label and $hint are keys of the installer strings; $value is shown as is (escaped).
 */
final class Check
{
    public const OK = 'ok';
    public const WARN = 'warn';
    public const ERROR = 'error';

    /**
     * @param array<string, string|int> $params placeholders of the hint
     */
    public function __construct(
        public readonly string $id,
        public readonly string $status,
        public readonly string $label,
        public readonly string $value = '',
        public readonly ?string $hint = null,
        public readonly array $params = [],
    ) {
    }

    /**
     * OK when $ok, otherwise $failStatus with $failHint.
     */
    public static function when(
        bool $ok,
        string $id,
        string $label,
        string $value,
        string $failHint,
        string $failStatus = self::ERROR,
        ?string $okHint = null,
    ): self {
        return new self($id, $ok ? self::OK : $failStatus, $label, $value, $ok ? $okHint : $failHint);
    }

    /**
     * @param list<Check> $checks
     */
    public static function worst(array $checks): string
    {
        $worst = self::OK;
        foreach ($checks as $check) {
            if ($check->status === self::ERROR) {
                return self::ERROR;
            }
            if ($check->status === self::WARN) {
                $worst = self::WARN;
            }
        }

        return $worst;
    }

    /**
     * @return array{id:string,status:string,label:string,value:string,hint:?string,params:array<string, string|int>}
     */
    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'status' => $this->status,
            'label' => $this->label,
            'value' => $this->value,
            'hint' => $this->hint,
            'params' => $this->params,
        ];
    }

    /**
     * @param array<string, mixed> $a
     */
    public static function fromArray(array $a): self
    {
        $params = is_array($a['params'] ?? null) ? $a['params'] : [];

        return new self(
            (string) ($a['id'] ?? ''),
            (string) ($a['status'] ?? self::ERROR),
            (string) ($a['label'] ?? ''),
            (string) ($a['value'] ?? ''),
            isset($a['hint']) ? (string) $a['hint'] : null,
            array_map(static fn (mixed $v): string|int => is_int($v) ? $v : (string) $v, $params),
        );
    }
}
