<?php

declare(strict_types=1);

namespace JDR\Install;

defined('JDR_BOOT') || exit;

/**
 * Step 2: database form, checks, and the choice when tables already use the prefix
 * (cancel / other prefix / resume an interrupted installation / overwrite with double confirmation).
 * The overwrite itself happens at step 5 only.
 */
final class DatabaseStep
{
    private const DEFAULTS = ['host' => 'localhost', 'port' => '3306', 'name' => '', 'user' => '', 'prefix' => 'jdr_'];

    public function __construct(
        private Env $env,
        private State $state,
        private Page $page,
        private ?DbInspector $inspector = null,
    ) {
        $this->inspector ??= new DbInspector();
    }

    /**
     * @param array<string, mixed> $post
     */
    public function handle(bool $isPost, array $post): Reply
    {
        if (!$isPost) {
            $pending = $this->state->get('db_pending');

            return $this->form([], [], is_array($pending) ? $pending : null);
        }

        return ($post['action'] ?? '') === 'choice' ? $this->choice($post) : $this->test($post);
    }

    /**
     * @param array<string, mixed> $post
     */
    private function test(array $post): Reply
    {
        [$clean, $errors] = Validator::database($post);
        $saved = $this->savedPassword();
        if ($clean['pass'] === '' && $saved !== '') {
            $clean['pass'] = $saved;
        }
        $this->state->remove('db_pending');
        if ($errors !== []) {
            return $this->form($clean, $errors, null);
        }
        $inspection = $this->inspector->inspect($clean);
        $pending = $clean + [
            'checks' => array_map(static fn (Check $c): array => $c->toArray(), $inspection['checks']),
            'existing' => $inspection['existing'],
            'resumable' => $inspection['resumable'],
            'ok' => $inspection['ok'],
            'pass_ok' => $inspection['ok'],
        ];
        if ($inspection['ok'] && $inspection['existing'] === []) {
            $this->saveDb($clean, 'fresh', 0);

            return Reply::redirect(Installer::url('site'));
        }
        $this->state->set('db_pending', $pending);

        return $this->form($clean, [], $pending);
    }

    /**
     * @param array<string, mixed> $post
     */
    private function choice(array $post): Reply
    {
        $pending = $this->state->get('db_pending');
        if (!is_array($pending) || ($pending['ok'] ?? false) !== true || ($pending['existing'] ?? []) === []) {
            return Reply::redirect(Installer::url('database'));
        }
        $choice = (string) ($post['choice'] ?? '');
        $count = count((array) $pending['existing']);
        if ($choice === 'resume' && ($pending['resumable'] ?? false) === true) {
            $this->saveDb($pending, 'resume', $count);

            return Reply::redirect(Installer::url('site'));
        }
        if ($choice === 'overwrite') {
            $confirmed = ($post['confirm1'] ?? '') === '1'
                && is_string($post['confirm2'] ?? null)
                && hash_equals((string) $pending['prefix'], trim($post['confirm2']));
            if ($confirmed) {
                $this->saveDb($pending, 'overwrite', $count);

                return Reply::redirect(Installer::url('site'));
            }

            return $this->form($pending, ['choice' => 'overwrite_confirm'], $pending);
        }
        if ($choice === 'resume') {
            return $this->form($pending, ['choice' => 'not_resumable'], $pending);
        }
        // Cancel: nothing is touched; the form is shown again (to pick another prefix, for instance).
        $this->state->set('db_pending', ['checks' => [], 'existing' => [], 'resumable' => false, 'ok' => false]
            + array_diff_key($pending, ['checks' => 1, 'existing' => 1, 'resumable' => 1, 'ok' => 1]));

        return Reply::redirect(Installer::url('database'));
    }

    /**
     * @param array<string, mixed> $db
     */
    private function saveDb(array $db, string $mode, int $existing): void
    {
        $this->state->remove('db_pending');
        $this->state->set('db', [
            'host' => (string) $db['host'],
            'port' => (int) $db['port'],
            'name' => (string) $db['name'],
            'user' => (string) $db['user'],
            'pass' => (string) $db['pass'],
            'prefix' => (string) $db['prefix'],
            'mode' => $mode,
            'existing' => $existing,
        ]);
    }

    private function savedPassword(): string
    {
        // Only a password that already connected successfully is kept (an empty one may be legitimate).
        foreach (['db_pending', 'db'] as $key) {
            $db = $this->state->get($key);
            $verified = $key === 'db' || (is_array($db) && ($db['pass_ok'] ?? false) === true);
            if ($verified && is_array($db) && is_string($db['pass'] ?? null) && $db['pass'] !== '') {
                return $db['pass'];
            }
        }

        return '';
    }

    /**
     * @param array<string, mixed>      $values
     * @param array<string, string>     $errors
     * @param array<string, mixed>|null $pending
     */
    private function form(array $values, array $errors, ?array $pending): Reply
    {
        $saved = (array) ($this->state->get('db') ?? []);
        $base = $values !== [] ? $values : ($pending ?? $saved);
        $shown = [];
        foreach (self::DEFAULTS as $key => $default) {
            $shown[$key] = isset($base[$key]) && (string) $base[$key] !== '' ? (string) $base[$key] : $default;
        }
        $shown['create_db'] = (bool) ($base['create_db'] ?? false);
        $checks = array_map(
            static fn (array $c): Check => Check::fromArray($c),
            $pending !== null ? (array) $pending['checks'] : []
        );
        $failed = $pending !== null && $checks !== [] && ($pending['ok'] ?? false) !== true;
        $status = $errors !== [] || $failed ? 422 : 200;

        return Reply::html($this->page->render('database', [
            'values' => $shown,
            'errors' => $errors,
            'checks' => $checks,
            'pending' => $pending,
            'hasSavedPassword' => $this->savedPassword() !== '',
            'token' => $this->state->token(),
            'flash' => $this->flash($errors),
        ], 'database'), $status);
    }

    /**
     * @param array<string, string> $errors
     */
    private function flash(array $errors): ?string
    {
        $flash = $this->state->get('flash');
        if (is_string($flash)) {
            $this->state->remove('flash');

            return $flash;
        }

        return array_diff_key($errors, ['choice' => true]) !== [] ? 'err.form' : null;
    }
}
