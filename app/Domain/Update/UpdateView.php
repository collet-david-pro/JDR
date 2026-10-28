<?php

declare(strict_types=1);

namespace JDR\Domain\Update;

defined('JDR_BOOT') || exit;

/**
 * Renders app/Views/update/<view>.php inside layout.php (same contract as the installer's Page):
 * templates receive their variables plus $e (escaper), $t (escaped string), $tr (raw string), $nonce.
 */
final class UpdateView
{
    public function __construct(private string $nonce, private ?string $directory = null)
    {
        $this->directory ??= dirname(__DIR__, 2) . '/Views/update';
    }

    public static function e(string|int|float|null $value): string
    {
        return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }

    /**
     * @param array<string, mixed> $vars
     */
    public function render(string $view, array $vars = []): string
    {
        $content = $this->renderFile($view, $vars);

        return $this->renderFile('layout', [
            'content' => $content,
            'title' => (string) ($vars['title'] ?? UpdateText::t('page.title')),
        ]);
    }

    /**
     * @param array<string, mixed> $vars
     */
    private function renderFile(string $view, array $vars): string
    {
        if (preg_match('/^[a-z][a-z0-9-]*$/', $view) !== 1) {
            throw new \InvalidArgumentException('Invalid view name.');
        }
        $vars['e'] = static fn (string|int|float|null $v): string => self::e($v);
        $vars['t'] = static fn (string $key, array $params = []): string => self::e(UpdateText::t($key, $params));
        $vars['tr'] = static fn (string $key, array $params = []): string => UpdateText::t($key, $params);
        $vars['nonce'] = $this->nonce;
        $level = ob_get_level();
        ob_start();
        try {
            (static function (string $__file, array $__vars): void {
                extract($__vars, EXTR_SKIP);
                require $__file;
            })($this->directory . '/' . $view . '.php', $vars);

            return (string) ob_get_clean();
        } catch (\Throwable $e) {
            while (ob_get_level() > $level) {
                ob_end_clean();
            }
            throw $e;
        }
    }
}
