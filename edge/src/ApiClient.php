<?php
declare(strict_types=1);

namespace Iln\Edge;

/**
 * Pemanggil API internal.
 *
 * Lapisan ini hanya boleh memanggil rute yang sudah dikenal. Tujuan backend
 * berasal dari environment, bukan dari request, jadi parameter path tidak
 * bisa dipakai untuk mengarahkan ulang permintaan ke host lain.
 */
final class ApiClient
{
    /** Rute baca yang bentuknya tetap. */
    private const GET_ROUTES = [
        '#^/api/health$#',
        '#^/api/catalog$#',
        '#^/api/daily$#',
        '#^/api/genres$#',
        '#^/api/recommendations$#',
        '#^/api/download$#',
        '#^/api/laporan-tautan$#',
    ];

    /** Rute baca yang membawa slug. Slug dibatasi karakter aman. */
    private const GET_PARAM_ROUTES = [
        '#^/api/anime/[A-Za-z0-9._~-]+$#',
        '#^/api/anime/[A-Za-z0-9._~-]+/(downloads|episode-supplement)$#',
        '#^/api/streams/[A-Za-z0-9._~-]+$#',
    ];

    public function __construct(private readonly Config $config)
    {
    }

    public static function isAllowed(string $path, string $method = 'GET'): bool
    {
        $method = strtoupper($method);
        if ($method === 'POST') {
            return $path === '/api/laporan-tautan';
        }
        if ($method !== 'GET' && $method !== 'HEAD') {
            return false;
        }
        foreach (self::GET_ROUTES as $pattern) {
            if (preg_match($pattern, $path) === 1) {
                return true;
            }
        }
        foreach (self::GET_PARAM_ROUTES as $pattern) {
            if (preg_match($pattern, $path) === 1) {
                return true;
            }
        }
        return false;
    }

    /**
     * Tolak path yang bisa keluar dari ruang /api/ atau menyelundupkan
     * pemisah lain. Backslash, persen, dan ".." tidak pernah dibutuhkan
     * oleh slug yang sah.
     */
    public static function sanitizePath(string $path): string
    {
        if ($path === '' || $path[0] !== '/') {
            throw new \RuntimeException('Path tidak valid');
        }
        if (strlen($path) > 512) {
            throw new \RuntimeException('Path terlalu panjang');
        }
        if (preg_match('#[\x00-\x1F\x7F\\\\]#', $path) === 1) {
            throw new \RuntimeException('Path memuat karakter terlarang');
        }
        if (str_contains($path, '..') || str_contains($path, '//') || str_contains($path, '%')) {
            throw new \RuntimeException('Path memuat rangkaian terlarang');
        }
        if (strpbrk($path, '?#') !== false) {
            throw new \RuntimeException('Path memuat pemisah query/fragmen');
        }
        return $path;
    }

    public static function sanitizeQuery(string $query): string
    {
        if ($query === '') {
            return '';
        }
        if (strlen($query) > 2048) {
            throw new \RuntimeException('Query terlalu panjang');
        }
        if (preg_match('/[\x00-\x1F\x7F]/', $query) === 1) {
            throw new \RuntimeException('Query memuat karakter kendali');
        }
        if (preg_match("#^[A-Za-z0-9._~!$&'()*+,;=:@/?%-]+$#", $query) !== 1) {
            throw new \RuntimeException('Query memuat karakter terlarang');
        }
        /* CR/LF yang di-encode tetap tidak boleh lolos: ia bisa berubah
           menjadi header baru di lapisan lain. */
        if (preg_match('/%(0d|0a|00)/i', $query) === 1) {
            throw new \RuntimeException('Query memuat escape terlarang');
        }
        return $query;
    }

    /**
     * Tanda tangan edge -> backend. Backend bisa menolak permintaan yang
     * tidak membawa tanda tangan ini, sehingga API internal tidak bisa
     * dipanggil langsung dari luar tanpa melewati lapisan tepi.
     */
    public static function edgeToken(string $secret, string $method, string $path, string $query, int $timestamp): string
    {
        $canonical = implode("\n", [strtoupper($method), $path, $query, (string) $timestamp]);
        return 'v1.' . $timestamp . '.' . hash_hmac('sha256', $canonical, $secret);
    }

    /**
     * @return array{status:int, body:string, contentType:string, location:string, retryAfter:string}
     */
    public function forward(string $method, string $path, string $query, ?string $body, string $clientIp): array
    {
        $method = strtoupper($method);
        $path = self::sanitizePath($path);
        $query = self::sanitizeQuery($query);
        if (!self::isMethodAllowed($method, $path)) {
            throw new \RuntimeException('Rute tidak diizinkan');
        }

        $url = $this->config->backendBase . $path . ($query !== '' ? '?' . $query : '');
        $headers = [
            'Accept: application/json',
            'X-Forwarded-For: ' . self::safeIp($clientIp),
            'X-Forwarded-Proto: ' . ((($_SERVER['HTTPS'] ?? '') === 'on') ? 'https' : 'http'),
        ];
        if ($this->config->edgeSecret !== '') {
            $timestamp = time();
            $headers[] = 'X-ILN-Edge: ' . self::edgeToken($this->config->edgeSecret, $method, $path, $query, $timestamp);
        }
        if ($body !== null) {
            $headers[] = 'Content-Type: application/json';
        }

        $contentType = 'application/json; charset=utf-8';
        $location = '';
        $retryAfter = '';
        $buffer = '';
        $tooLarge = false;
        $maxBytes = $this->config->maxResponseBytes;

        $curl = curl_init($url);
        if ($curl === false) {
            throw new \RuntimeException('Tidak bisa membuat koneksi');
        }

        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => false,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_MAXREDIRS => 0,
            CURLOPT_CONNECTTIMEOUT_MS => min(2000, $this->config->timeoutMs),
            CURLOPT_TIMEOUT_MS => $this->config->timeoutMs,
            CURLOPT_NOSIGNAL => true,
            CURLOPT_PROTOCOLS_STR => 'http,https',
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_USERAGENT => 'iln-edge/1',
            CURLOPT_HEADERFUNCTION => static function ($curl, string $line) use (&$contentType, &$location, &$retryAfter): int {
                if (preg_match('#^HTTP/#i', $line) === 1) {
                    $contentType = 'application/json; charset=utf-8';
                    $location = '';
                    $retryAfter = '';
                    return strlen($line);
                }
                $separator = strpos($line, ':');
                if ($separator === false) {
                    return strlen($line);
                }
                $name = strtolower(trim(substr($line, 0, $separator)));
                $value = trim(substr($line, $separator + 1));
                if ($name === 'content-type') {
                    $contentType = $value;
                } elseif ($name === 'location') {
                    $location = $value;
                } elseif ($name === 'retry-after') {
                    $retryAfter = $value;
                }
                return strlen($line);
            },
            CURLOPT_WRITEFUNCTION => static function ($curl, string $chunk) use (&$buffer, &$tooLarge, $maxBytes): int {
                if (strlen($buffer) + strlen($chunk) > $maxBytes) {
                    $tooLarge = true;
                    return 0;
                }
                $buffer .= $chunk;
                return strlen($chunk);
            },
        ]);

        if ($method === 'HEAD') {
            curl_setopt($curl, CURLOPT_NOBODY, true);
        } elseif ($method === 'POST') {
            curl_setopt($curl, CURLOPT_POST, true);
            curl_setopt($curl, CURLOPT_POSTFIELDS, $body ?? '');
        } else {
            curl_setopt($curl, CURLOPT_HTTPGET, true);
        }

        $ok = curl_exec($curl);
        $error = curl_error($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        unset($curl);

        if ($tooLarge) {
            throw new \RuntimeException('Respons backend terlalu besar');
        }
        if ($ok === false || $status === 0) {
            throw new \RuntimeException('Backend tidak merespons: ' . $error);
        }

        return [
            'status' => $status,
            'body' => $buffer,
            'contentType' => $contentType,
            'location' => $location,
            'retryAfter' => $retryAfter,
        ];
    }

    public static function isMethodAllowed(string $method, string $path): bool
    {
        $method = strtoupper($method);
        if ($method === 'HEAD') {
            return self::isAllowed($path, 'GET');
        }
        return self::isAllowed($path, $method);
    }

    private static function safeIp(string $ip): string
    {
        return filter_var($ip, FILTER_VALIDATE_IP) !== false ? $ip : '0.0.0.0';
    }
}
