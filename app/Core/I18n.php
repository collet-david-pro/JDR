<?php

declare(strict_types=1);

namespace JDR\Core;

defined('JDR_BOOT') || exit;

/**
 * Server-side translations from i18n/{locale}.json (shared with the front-end).
 * Keys are dotted paths into a nested object: t('errors.not_found').
 * Parameters: "{name}" placeholders.
 */
final class I18n
{
    /** @var array<string, mixed>|null */
    private ?array $messages = null;

    public function __construct(private string $file)
    {
    }

    public static function forLocale(string $locale = 'fr'): self
    {
        $locale = preg_match('/^[a-z]{2}(?:-[A-Z]{2})?$/', $locale) === 1 ? $locale : 'fr';

        return new self(dirname(__DIR__, 2) . '/i18n/' . $locale . '.json');
    }

    public function has(string $key): bool
    {
        return is_string($this->lookup($key));
    }

    /**
     * @param array<string, string|int|float> $params
     */
    public function t(string $key, array $params = []): string
    {
        $value = $this->lookup($key);
        $text = is_string($value) ? $value : $key;
        foreach ($params as $name => $param) {
            $text = str_replace('{' . $name . '}', (string) $param, $text);
        }

        return $text;
    }

    /**
     * @return array<string, mixed>
     */
    public function all(): array
    {
        if ($this->messages === null) {
            $this->messages = [];
            $json = is_file($this->file) ? file_get_contents($this->file) : false;
            if (is_string($json)) {
                $data = json_decode($json, true);
                $this->messages = is_array($data) ? $data : [];
            }
        }

        return $this->messages;
    }

    private function lookup(string $key): mixed
    {
        $node = $this->all();
        if (array_key_exists($key, $node)) {
            return $node[$key];
        }
        foreach (explode('.', $key) as $part) {
            if (!is_array($node) || !array_key_exists($part, $node)) {
                return null;
            }
            $node = $node[$part];
        }

        return $node;
    }
}
