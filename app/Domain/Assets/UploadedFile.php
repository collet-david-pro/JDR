<?php

declare(strict_types=1);

namespace JDR\Domain\Assets;

defined('JDR_BOOT') || exit;

use JDR\Core\Request;

/**
 * One file of a multipart request. Built from $_FILES in production, or from a local path
 * (tests, request attribute "multipart_files"). The client name and type are only hints.
 */
final class UploadedFile
{
    public function __construct(
        public readonly string $tmpPath,
        public readonly string $clientName,
        public readonly int $size,
        public readonly int $error,
        private bool $httpUpload,
    ) {
    }

    /**
     * Test / internal source: an existing local file.
     */
    public static function fromPath(string $path, string $clientName, int $error = UPLOAD_ERR_OK): self
    {
        return new self($path, $clientName, is_file($path) ? (int) filesize($path) : 0, $error, false);
    }

    /**
     * One entry of $_FILES; null when absent or when several files were sent under the same name.
     *
     * @param mixed $spec
     */
    public static function fromSpec(mixed $spec): ?self
    {
        if (!is_array($spec) || !isset($spec['error']) || is_array($spec['error'])) {
            return null;
        }

        return new self(
            is_string($spec['tmp_name'] ?? null) ? $spec['tmp_name'] : '',
            is_string($spec['name'] ?? null) ? $spec['name'] : '',
            is_int($spec['size'] ?? null) ? $spec['size'] : 0,
            (int) $spec['error'],
            true,
        );
    }

    /**
     * File field of the request: attribute "multipart_files" (tests) or $_FILES.
     */
    public static function fromRequest(Request $request, string $field): ?self
    {
        $files = $request->attribute('multipart_files');
        if (is_array($files)) {
            $file = $files[$field] ?? null;

            return $file instanceof self ? $file : null;
        }

        return self::fromSpec($_FILES[$field] ?? null);
    }

    /**
     * Text fields of the multipart request: attribute "multipart_fields" (tests) or $_POST.
     *
     * @return array<string, mixed>
     */
    public static function fields(Request $request): array
    {
        $fields = $request->attribute('multipart_fields');
        $fields = is_array($fields) ? $fields : $_POST;
        $out = [];
        foreach ($fields as $key => $value) {
            if (is_string($key)) {
                $out[$key] = $value;
            }
        }

        return $out;
    }

    /**
     * Moves the file (immediately after reception) to $destination.
     */
    public function moveTo(string $destination): bool
    {
        if ($this->httpUpload) {
            return @move_uploaded_file($this->tmpPath, $destination);
        }

        return @copy($this->tmpPath, $destination);
    }
}
