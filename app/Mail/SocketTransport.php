<?php

declare(strict_types=1);

namespace JDR\Mail;

defined('JDR_BOOT') || exit;

/**
 * TCP/TLS socket (stream_socket_client), certificate verified, read/write timeouts.
 */
final class SocketTransport implements SmtpTransport
{
    /** @var resource|null */
    private $stream = null;
    private string $host = '';

    public function connect(string $host, int $port, bool $implicitTls, int $timeout): void
    {
        $this->host = $host;
        $context = stream_context_create(['ssl' => [
            'verify_peer' => true,
            'verify_peer_name' => true,
            'peer_name' => $host,
            'SNI_enabled' => true,
        ]]);
        $errno = 0;
        $errstr = '';
        $stream = @stream_socket_client(
            ($implicitTls ? 'ssl://' : 'tcp://') . $host . ':' . $port,
            $errno,
            $errstr,
            $timeout,
            STREAM_CLIENT_CONNECT,
            $context,
        );
        if ($stream === false) {
            throw new SmtpException(sprintf('Connection to %s:%d failed: %s (%d)', $host, $port, $errstr, $errno));
        }
        stream_set_timeout($stream, $timeout);
        $this->stream = $stream;
    }

    public function enableTls(): void
    {
        $method = STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT;
        if (defined('STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT')) {
            $method |= STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT;
        }
        if (@stream_socket_enable_crypto($this->stream(), true, $method) !== true) {
            throw new SmtpException('TLS negotiation with ' . $this->host . ' failed.');
        }
    }

    public function readLine(): string
    {
        $line = fgets($this->stream(), 2048);
        if ($line === false) {
            $meta = stream_get_meta_data($this->stream());
            throw new SmtpException(($meta['timed_out'] ?? false) ? 'SMTP server timed out.' : 'SMTP connection closed.');
        }

        return $line;
    }

    public function write(string $data): void
    {
        $length = strlen($data);
        $written = 0;
        while ($written < $length) {
            $n = @fwrite($this->stream(), substr($data, $written));
            if ($n === false || $n === 0) {
                throw new SmtpException('SMTP write failed.');
            }
            $written += $n;
        }
    }

    public function close(): void
    {
        if ($this->stream !== null) {
            @fclose($this->stream);
            $this->stream = null;
        }
    }

    /**
     * @return resource
     */
    private function stream()
    {
        if ($this->stream === null) {
            throw new SmtpException('Not connected.');
        }

        return $this->stream;
    }
}
