<?php

declare(strict_types=1);

namespace JDR\Core;

defined('JDR_BOOT') || exit;

/**
 * Minimal PHP template renderer for app/Views/*.php.
 * Templates receive their variables plus $e (HTML escaper), $t (escaped translation)
 * and $tr (raw translation, to be escaped by the template).
 */
final class View
{
    public function __construct(private I18n $i18n, private ?string $directory = null)
    {
        $this->directory ??= dirname(__DIR__) . '/Views';
    }

    public static function e(string|int|float|null $value): string
    {
        return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }

    /**
     * @param array<string, mixed> $vars
     */
    public function render(string $template, array $vars = []): string
    {
        if (preg_match('/^[a-z][a-z0-9-]*$/', $template) !== 1) {
            throw new \InvalidArgumentException('Invalid template name.');
        }
        $file = $this->directory . '/' . $template . '.php';
        $i18n = $this->i18n;
        $vars['e'] = static fn (string|int|float|null $v): string => self::e($v);
        $vars['t'] = static fn (string $key, array $params = []): string => self::e($i18n->t($key, $params));
        $vars['tr'] = static fn (string $key, array $params = []): string => $i18n->t($key, $params);

        $level = ob_get_level();
        ob_start();
        try {
            (static function (string $__file, array $__vars): void {
                extract($__vars, EXTR_SKIP);
                require $__file;
            })($file, $vars);

            return (string) ob_get_clean();
        } catch (\Throwable $e) {
            while (ob_get_level() > $level) {
                ob_end_clean();
            }
            throw $e;
        }
    }
}
