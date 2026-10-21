<?php

declare(strict_types=1);

namespace JDR\Imaging;

defined('JDR_BOOT') || exit;

use JDR\Core\Errors\HttpException;

/**
 * An uploaded image refused by the pipeline (projet.md 11.3).
 *
 * errorCode(): one of the four API codes below (HTTP status 415, 413 or 422, see 9.2 / P2 contract).
 * reason():    stable, more detailed identifier (e.g. "gif_invalid", "dimension_exceeded") for
 *              logs and tests; never shown to users as is.
 * detail():    technical English message for the logs (no file paths, no user data).
 * getMessage(): always empty, so that the error handler answers with the translated generic
 *              message errors.{code}: nothing technical reaches the client.
 *
 * Note: extends HttpException and not ValidationException, which is final and bound to 422.
 */
final class ImageRejected extends HttpException
{
    public const UNSUPPORTED_TYPE = 'unsupported_type';
    public const IMAGE_TOO_LARGE = 'image_too_large';
    public const ANIMATION_TOO_LONG = 'animation_too_long';
    public const FILE_TOO_LARGE = 'file_too_large';

    private const STATUS = [
        self::UNSUPPORTED_TYPE => 415,
        self::IMAGE_TOO_LARGE => 422,
        self::ANIMATION_TOO_LONG => 422,
        self::FILE_TOO_LARGE => 413,
    ];

    private function __construct(string $code, private string $reason, private string $detail)
    {
        parent::__construct(self::STATUS[$code], $code, '');
    }

    public static function unsupportedType(string $reason, string $detail): self
    {
        return new self(self::UNSUPPORTED_TYPE, $reason, $detail);
    }

    public static function imageTooLarge(string $reason, string $detail): self
    {
        return new self(self::IMAGE_TOO_LARGE, $reason, $detail);
    }

    public static function animationTooLong(string $reason, string $detail): self
    {
        return new self(self::ANIMATION_TOO_LONG, $reason, $detail);
    }

    public static function fileTooLarge(string $reason, string $detail): self
    {
        return new self(self::FILE_TOO_LARGE, $reason, $detail);
    }

    public function reason(): string
    {
        return $this->reason;
    }

    /** Technical English description, for the logs only. */
    public function detail(): string
    {
        return $this->detail;
    }
}
