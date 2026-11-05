<?php

declare(strict_types=1);

namespace JDR\Domain\Update;

defined('JDR_BOOT') || exit;

/**
 * Ed25519 signature of a release's SHA256SUMS (detached, base64, published as SHA256SUMS.sig).
 * Needs the sodium extension; without it the automatic update is off (the manual upload still works).
 * Releases up to LAST_UNSIGNED were published without a signature.
 */
final class ReleaseSignature
{
    /** Raw Ed25519 public key (32 bytes), base64. */
    public const PUBLIC_KEY = 'LVAsGdcMjKRwhUD191gpIZ2o1Lj1psMhDAIkOTGD+sw=';
    public const LAST_UNSIGNED = '0.2.0';

    private string $publicKey;
    private bool $available;

    /**
     * @param string|null $publicKey base64 key (tests); the release key by default
     * @param bool|null $available forces the answer of available() (tests)
     */
    public function __construct(?string $publicKey = null, ?bool $available = null)
    {
        $this->publicKey = $publicKey ?? self::PUBLIC_KEY;
        $this->available = $available ?? function_exists('sodium_crypto_sign_verify_detached');
    }

    /**
     * Tells whether signature verification can run (libsodium and a public key are present).
     */
    public function available(): bool
    {
        return $this->available;
    }

    /**
     * True when $version is signed by the release process (above LAST_UNSIGNED).
     */
    public static function expectedFor(string $version): bool
    {
        return Semver::greaterThan($version, self::LAST_UNSIGNED);
    }

    /**
     * @param string $sums exact bytes of SHA256SUMS
     * @param string $sigB64 content of SHA256SUMS.sig
     */
    public function verify(string $sums, string $sigB64): bool
    {
        if (!$this->available || !function_exists('sodium_crypto_sign_verify_detached')) {
            return false;
        }
        $key = base64_decode($this->publicKey, true);
        $signature = base64_decode(trim($sigB64), true);
        if ($key === false || $signature === false || strlen($key) !== SODIUM_CRYPTO_SIGN_PUBLICKEYBYTES
            || strlen($signature) !== SODIUM_CRYPTO_SIGN_BYTES) {
            return false;
        }
        try {
            return sodium_crypto_sign_verify_detached($signature, $sums, $key);
        } catch (\Throwable) {
            return false;
        }
    }
}
