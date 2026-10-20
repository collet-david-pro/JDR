<?php

declare(strict_types=1);

namespace JDR\Domain\Settings;

defined('JDR_BOOT') || exit;

/**
 * Symmetric encryption of stored secrets (SMTP password) with a key derived from app_secret:
 * sodium crypto_secretbox when available ("s1:"), else OpenSSL AES-256-GCM ("o1:").
 */
final class SecretBox
{
    public function __construct(private string $appSecret)
    {
        if (strlen($appSecret) < 16) {
            throw new \InvalidArgumentException('app_secret is missing or too short.');
        }
    }

    public function encrypt(#[\SensitiveParameter] string $plain): string
    {
        if (function_exists('sodium_crypto_secretbox')) {
            $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);

            return 's1:' . base64_encode($nonce . sodium_crypto_secretbox($plain, $nonce, $this->key()));
        }
        $iv = random_bytes(12);
        $tag = '';
        $cipher = openssl_encrypt($plain, 'aes-256-gcm', $this->key(), OPENSSL_RAW_DATA, $iv, $tag);
        if ($cipher === false) {
            throw new \RuntimeException('Encryption failed.');
        }

        return 'o1:' . base64_encode($iv . $tag . $cipher);
    }

    /**
     * Null when the value cannot be decrypted (other app_secret, corrupted, unsupported).
     */
    public function decrypt(string $encrypted): ?string
    {
        $raw = base64_decode(substr($encrypted, 3), true);
        if ($raw === false) {
            return null;
        }
        if (str_starts_with($encrypted, 's1:') && function_exists('sodium_crypto_secretbox_open')) {
            $n = SODIUM_CRYPTO_SECRETBOX_NONCEBYTES;
            if (strlen($raw) <= $n) {
                return null;
            }
            $plain = sodium_crypto_secretbox_open(substr($raw, $n), substr($raw, 0, $n), $this->key());

            return $plain === false ? null : $plain;
        }
        if (str_starts_with($encrypted, 'o1:') && function_exists('openssl_decrypt')) {
            if (strlen($raw) < 28) {
                return null;
            }
            $plain = openssl_decrypt(
                substr($raw, 28),
                'aes-256-gcm',
                $this->key(),
                OPENSSL_RAW_DATA,
                substr($raw, 0, 12),
                substr($raw, 12, 16),
            );

            return $plain === false ? null : $plain;
        }

        return null;
    }

    private function key(): string
    {
        return hash_hkdf('sha256', $this->appSecret, 32, 'jdr-secretbox-v1');
    }
}
