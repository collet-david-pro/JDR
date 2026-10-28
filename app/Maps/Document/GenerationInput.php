<?php

declare(strict_types=1);

namespace JDR\Maps\Document;

defined('JDR_BOOT') || exit;

use JDR\Domain\Games\Fields;

/**
 * Validation of a map "generation" block {generator, gen_version, seed, params} (projet.md 12.1),
 * shared by the map import (MapDocumentValidator) and PATCH /maps/{id} (MapInput::patch).
 * Errors are recorded under "generation", "generation.generator", "generation.gen_version",
 * "generation.seed" and "generation.params" (invalid | required | too_large).
 */
final class GenerationInput
{
    public const KEYS = ['generator', 'gen_version', 'seed', 'params'];
    public const MAX_PARAMS_BYTES = 65536;

    /**
     * @param array<string, string> $errors
     * @return array{generator: string, gen_version: int, seed: string, params: array<array-key, mixed>}|null
     *         null when the value is null or invalid (invalid: an error is recorded)
     */
    public static function parse(mixed $value, array &$errors): ?array
    {
        if ($value === null) {
            return null;
        }
        $g = Fields::object($value, self::KEYS);
        if ($g === null) {
            $errors['generation'] = 'invalid';

            return null;
        }
        $before = count($errors);
        $generator = $g['generator'] ?? null;
        if (!is_string($generator) || preg_match('/^[a-z0-9][a-z0-9_.-]{0,39}$/D', $generator) !== 1) {
            $errors['generation.generator'] = array_key_exists('generator', $g) ? 'invalid' : 'required';
        }
        $genVersion = Fields::int($g['gen_version'] ?? null, 1, 1000000);
        if ($genVersion === null) {
            $errors['generation.gen_version'] = array_key_exists('gen_version', $g) ? 'invalid' : 'required';
        }
        $seed = Fields::text($g['seed'] ?? null, 64);
        if ($seed === null || $seed === '') {
            $errors['generation.seed'] = array_key_exists('seed', $g) ? 'invalid' : 'required';
        }
        $params = $g['params'] ?? [];
        if (!is_array($params) || ($params !== [] && array_is_list($params))) {
            $errors['generation.params'] = 'invalid';
        } elseif (strlen((string) json_encode($params)) > self::MAX_PARAMS_BYTES) {
            $errors['generation.params'] = 'too_large';
        }
        if (count($errors) !== $before) {
            return null;
        }

        return ['generator' => (string) $generator, 'gen_version' => (int) $genVersion, 'seed' => (string) $seed, 'params' => $params];
    }
}
