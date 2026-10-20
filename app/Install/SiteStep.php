<?php

declare(strict_types=1);

namespace JDR\Install;

defined('JDR_BOOT') || exit;

/**
 * Step 3: site settings and storage location (inside the site, or a folder outside the web root).
 */
final class SiteStep
{
    public function __construct(private Env $env, private State $state, private Page $page)
    {
    }

    /**
     * @param array<string, mixed> $post
     */
    public function handle(bool $isPost, array $post): Reply
    {
        if (!$isPost) {
            return $this->form($this->defaults(), []);
        }
        [$clean, $errors] = Validator::site($post);
        if ($clean['storage'] === 'custom' && !isset($errors['storage_custom'])) {
            $path = $clean['storage_custom'];
            if (StorageSetup::isInside($path, [realpath($this->env->root) ?: $this->env->root, $this->env->documentRoot()])) {
                $errors['storage_custom'] = 'storage_public';
            } elseif (!StorageSetup::isUsable($path)) {
                $errors['storage_custom'] = 'storage_unusable';
            }
        }
        if ($errors !== []) {
            return $this->form($post + $this->defaults(), $errors);
        }
        $clean['storage_path'] = $clean['storage'] === 'custom' ? $clean['storage_custom'] : null;
        $this->state->set('site', $clean);

        return Reply::redirect(Installer::url('admin'));
    }

    /**
     * Values shown in the form (Mo for sizes).
     *
     * @return array<string, string>
     */
    private function defaults(): array
    {
        $saved = $this->state->get('site');
        if (is_array($saved)) {
            return [
                'site_name' => (string) $saved['site_name'],
                'base_url' => (string) $saved['base_url'],
                'default_locale' => (string) $saved['default_locale'],
                'registration_mode' => (string) $saved['registration_mode'],
                'default_quota_mb' => (string) intdiv((int) $saved['default_quota_bytes'], 1048576),
                'max_upload_mb' => (string) intdiv((int) $saved['max_upload_bytes'], 1048576),
                'max_dimension_px' => (string) $saved['max_dimension_px'],
                'storage' => (string) $saved['storage'],
                'storage_custom' => (string) $saved['storage_custom'],
            ];
        }

        return [
            'site_name' => 'JDR',
            'base_url' => $this->env->baseUrl(),
            'default_locale' => 'fr',
            'registration_mode' => 'open',
            'default_quota_mb' => '500',
            'max_upload_mb' => '10',
            'max_dimension_px' => '4096',
            'storage' => 'default',
            'storage_custom' => '',
        ];
    }

    /**
     * A folder next to the web root, when its parent is writable (projet.md 5.2 note).
     */
    private function suggestion(): ?string
    {
        $docRoot = $this->env->documentRoot();
        if ($docRoot === null) {
            return null;
        }
        $candidate = dirname($docRoot) . '/jdr-storage';

        return StorageSetup::isUsable($candidate)
            && !StorageSetup::isInside($candidate, [$docRoot, realpath($this->env->root) ?: null])
            ? $candidate : null;
    }

    /**
     * @param array<string, mixed>  $values
     * @param array<string, string> $errors
     */
    private function form(array $values, array $errors): Reply
    {
        $req = (array) $this->state->get('req', []);
        $flash = $this->state->get('flash');
        if (is_string($flash)) {
            $this->state->remove('flash');
        }
        $limit = min(
            Requirements::bytes(ini_get('upload_max_filesize')),
            Requirements::bytes(ini_get('post_max_size'))
        );

        return Reply::html($this->page->render('site', [
            'values' => array_map(static fn (mixed $v): string => is_string($v) ? $v : '', $values),
            'errors' => $errors,
            'routing' => (string) ($req['routing_mode'] ?? 'query'),
            'defaultStorage' => $this->env->root . '/storage',
            'suggestion' => $this->suggestion(),
            'uploadLimit' => Requirements::human($limit),
            'token' => $this->state->token(),
            'flash' => is_string($flash) ? $flash : ($errors !== [] ? 'err.form' : null),
        ], 'site'), $errors === [] ? 200 : 422);
    }
}
