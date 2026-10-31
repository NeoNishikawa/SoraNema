<?php
declare(strict_types=1);

namespace Iln\Edge;

/**
 * Konfigurasi lapisan tepi.
 *
 * Semua nilai datang dari environment, bukan dari request. Request tidak
 * boleh bisa mengubah tujuan backend, mode seal, atau batas ukuran.
 */
final class Config
{
    public function __construct(
        public readonly string $backendBase,
        public readonly string $sealDigest,
        public readonly string $sealMode,
        public readonly string $edgeSecret,
        public readonly int $timeoutMs,
        public readonly int $maxResponseBytes,
    ) {
    }

    public static function fromEnv(): self
    {
        $base = rtrim(trim((string) (getenv('ILN_BACKEND_URL') ?: 'http://127.0.0.1:3099')), '/');
        $parts = parse_url($base);
        if (
            !is_array($parts)
            || !in_array(strtolower((string) ($parts['scheme'] ?? '')), ['http', 'https'], true)
            || empty($parts['host'])
            || isset($parts['user'])
            || isset($parts['pass'])
        ) {
            throw new \RuntimeException('ILN_BACKEND_URL tidak valid');
        }

        $mode = strtolower(trim((string) (getenv('ILN_SEAL_MODE') ?: 'off')));
        if (!in_array($mode, ['off', 'report', 'enforce'], true)) {
            /* Salah ketik tidak boleh diam-diam mematikan pemeriksaan. */
            throw new \RuntimeException('ILN_SEAL_MODE tidak valid');
        }

        $digest = trim((string) (getenv('ILN_SEAL_DIGEST') ?: ''));
        if ($mode !== 'off' && $digest === '') {
            throw new \RuntimeException('ILN_SEAL_DIGEST wajib diisi saat seal aktif');
        }

        $timeout = (int) (getenv('ILN_UPSTREAM_TIMEOUT_MS') ?: 8000);
        $timeout = max(500, min(30000, $timeout));

        $maxBytes = (int) (getenv('ILN_MAX_RESPONSE_BYTES') ?: 2 * 1024 * 1024);
        $maxBytes = max(64 * 1024, min(8 * 1024 * 1024, $maxBytes));

        return new self(
            $base,
            $digest,
            $mode,
            (string) (getenv('ILN_EDGE_SECRET') ?: ''),
            $timeout,
            $maxBytes,
        );
    }
}
