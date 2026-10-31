<?php
declare(strict_types=1);

namespace Iln\Edge;

/**
 * Pemeriksa pecahan segel dari klien.
 *
 * Klien mengirim digest yang sama dengan yang tertanam di halaman
 * (header X-ILN-Seal). Kalau seal dihapus atau diubah, header itu hilang
 * atau tidak cocok. Ini BUKAN autentikasi: siapa pun yang membaca halaman
 * bisa menyalin digest-nya. Nilainya hanya menaikkan biaya bypass, bukan
 * menjadikannya mustahil - jangan dipakai untuk melindungi rahasia.
 */
final class SealGuard
{
    public function __construct(
        private readonly string $expectedDigest,
        private readonly string $mode,
    ) {
    }

    public static function fromConfig(Config $config): self
    {
        return new self($config->sealDigest, $config->sealMode);
    }

    public function mode(): string
    {
        return $this->mode;
    }

    /**
     * true = lolos. Saat mode off, pemeriksaan dilewati.
     */
    public function verify(?string $presented): bool
    {
        if ($this->mode === 'off') {
            return true;
        }
        if (!is_string($presented)) {
            return false;
        }
        $presented = trim($presented);
        if ($presented === '' || strlen($presented) > 128) {
            return false;
        }
        return hash_equals($this->expectedDigest, $presented);
    }

    /**
     * Catat kegagalan hanya di log server. Jangan pernah mengirim detail
     * ini ke respons: pesan spesifik adalah petunjuk gratis bagi yang
     * sedang mencoba bypass.
     */
    public function logFailure(string $path, string $ip): void
    {
        $safePath = preg_replace('#[^A-Za-z0-9._~/-]#', '?', $path) ?: '/';
        $ipHash = substr(hash('sha256', $ip), 0, 12);
        error_log(sprintf('iln-edge seal-mismatch path=%s ip=%s', $safePath, $ipHash));
    }
}
