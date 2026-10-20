<?php

declare(strict_types=1);

namespace JDR\Tests\Core;

use JDR\Core\I18n;
use PHPUnit\Framework\TestCase;

final class I18nTest extends TestCase
{
    /** Stable API error codes (projet.md 9.1). */
    private const STABLE_CODES = [
        'unauthenticated', 'forbidden', 'not_found', 'validation_failed', 'revision_conflict', 'quota_exceeded',
        'file_too_large', 'unsupported_type', 'image_too_large', 'animation_too_long', 'session_code_invalid',
        'session_not_joinable', 'session_paused', 'blocked_by_wall', 'rate_limited', 'maintenance', 'events_gone',
        'payload_too_large',
    ];

    public function testFrenchFileIsValidJson(): void
    {
        $json = file_get_contents(JDR_ROOT . '/i18n/fr.json');
        self::assertIsString($json);
        self::assertIsArray(json_decode($json, true, 512, JSON_THROW_ON_ERROR));
    }

    public function testEveryStableErrorCodeIsTranslated(): void
    {
        $i18n = I18n::forLocale('fr');
        foreach ([...self::STABLE_CODES, 'bad_request', 'invalid_json', 'method_not_allowed', 'internal_error'] as $code) {
            self::assertTrue($i18n->has('errors.' . $code), $code);
        }
    }

    public function testParametersAndFallback(): void
    {
        $i18n = I18n::forLocale('fr');
        self::assertSame('Identifiant de requête : 42', $i18n->t('pages.error.request_id', ['id' => 42]));
        self::assertSame('missing.key', $i18n->t('missing.key'));
        self::assertFalse($i18n->has('errors'));
    }
}
