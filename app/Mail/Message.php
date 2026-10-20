<?php

declare(strict_types=1);

namespace JDR\Mail;

defined('JDR_BOOT') || exit;

/**
 * Plain-text UTF-8 e-mail: encoded headers (RFC 2047), quoted-printable body, CRLF line endings.
 */
final class Message
{
    public function __construct(
        public readonly string $fromEmail,
        public readonly string $fromName,
        public readonly string $to,
        public readonly string $subject,
        public readonly string $text,
    ) {
        foreach ([$fromEmail, $to] as $address) {
            if (!self::validAddress($address)) {
                throw new SmtpException('Invalid e-mail address.');
            }
        }
    }

    public static function validAddress(string $address): bool
    {
        return preg_match('/[\r\n<>"]/', $address) !== 1 && filter_var($address, FILTER_VALIDATE_EMAIL) !== false;
    }

    /**
     * Full message (headers + body), CRLF line endings, before dot-stuffing.
     */
    public function toMime(int $timestamp): string
    {
        $domain = substr((string) strrchr($this->fromEmail, '@'), 1);
        $headers = [
            'Date: ' . gmdate('D, d M Y H:i:s', $timestamp) . ' +0000',
            'From: ' . self::address($this->fromName, $this->fromEmail),
            'To: <' . $this->to . '>',
            'Subject: ' . self::encodeHeader($this->subject),
            'Message-ID: <' . bin2hex(random_bytes(12)) . '@' . ($domain !== '' ? $domain : 'localhost') . '>',
            'MIME-Version: 1.0',
            'Content-Type: text/plain; charset=UTF-8',
            'Content-Transfer-Encoding: quoted-printable',
        ];
        $text = str_replace(["\r\n", "\r"], "\n", $this->text);
        $body = quoted_printable_encode(str_replace("\n", "\r\n", $text));

        return implode("\r\n", $headers) . "\r\n\r\n" . $body;
    }

    /**
     * RFC 2047 encoded-words (base64) for non-ASCII text, split to keep lines short.
     */
    public static function encodeHeader(string $value): string
    {
        $value = str_replace(["\r", "\n"], ' ', $value);
        if (preg_match('/^[\x20-\x7E]*$/', $value) === 1 && strlen($value) <= 900) {
            return $value;
        }
        $words = [];
        foreach (mb_str_split($value, 30, 'UTF-8') as $chunk) {
            $words[] = '=?UTF-8?B?' . base64_encode($chunk) . '?=';
        }

        return implode("\r\n ", $words);
    }

    private static function address(string $name, string $email): string
    {
        $name = trim(str_replace(["\r", "\n", '"'], ' ', $name));
        if ($name === '') {
            return '<' . $email . '>';
        }
        $encoded = preg_match('/^[A-Za-z0-9 !#$%&\'*+\/=?^_`{|}~.-]*$/', $name) === 1
            ? '"' . $name . '"'
            : self::encodeHeader($name);

        return $encoded . ' <' . $email . '>';
    }
}
