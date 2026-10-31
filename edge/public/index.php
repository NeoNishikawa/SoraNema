<?php
declare(strict_types=1);

use Iln\Edge\ApiClient;
use Iln\Edge\Config;
use Iln\Edge\SealGuard;

/* Jangan bocorkan versi PHP atau pesan internal ke pengunjung. */
ini_set('display_errors', '0');
ini_set('expose_php', '0');
header_remove('X-Powered-By');

require __DIR__ . '/../src/Config.php';
require __DIR__ . '/../src/ApiClient.php';
require __DIR__ . '/../src/SealGuard.php';

const ILN_EDGE_MAX_BODY = 102_400;

function ilnRespondJson(int $status, string $body, array $headers = []): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    foreach ($headers as $name => $value) {
        if (preg_match('/[\r\n]/', (string) $value) === 1) {
            continue;
        }
        header($name . ': ' . $value);
    }
    echo $body;
}

/**
 * Bentuk yang sama dengan dataset kosong yang sah. Dipakai saat seal
 * gagal dan saat backend bermasalah, supaya tidak ada pesan khusus yang
 * memberi tahu penyerang pemeriksaan mana yang menangkapnya.
 */
function ilnRespondEmpty(int $status = 200): void
{
    ilnRespondJson($status, '{"data":[],"total":0}');
}

function ilnRespondNotFound(): void
{
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    echo 'Not found';
}

function ilnHandle(): void
{
    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    $uri = (string) ($_SERVER['REQUEST_URI'] ?? '/');
    $path = parse_url($uri, PHP_URL_PATH);
    if (!is_string($path) || $path === '' || !str_starts_with($path, '/api/')) {
        ilnRespondNotFound();
        return;
    }

    $config = Config::fromEnv();
    $clientIp = (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');

    $guard = SealGuard::fromConfig($config);
    $presented = isset($_SERVER['HTTP_X_ILN_SEAL']) ? (string) $_SERVER['HTTP_X_ILN_SEAL'] : null;
    if (!$guard->verify($presented)) {
        $guard->logFailure($path, $clientIp);
        if ($config->sealMode === 'enforce') {
            ilnRespondEmpty();
            return;
        }
    }

    /* Rute diperiksa SETELAH seal: pengunjung tanpa seal yang sah selalu
       melihat bentuk kosong, jadi tidak bisa memetakan rute mana yang ada
       hanya dari perbedaan 404 dan 200. */
    try {
        $path = ApiClient::sanitizePath($path);
    } catch (Throwable) {
        ilnRespondNotFound();
        return;
    }
    if (!ApiClient::isMethodAllowed($method, $path)) {
        ilnRespondNotFound();
        return;
    }

    $query = (string) ($_SERVER['QUERY_STRING'] ?? '');
    $body = null;
    if ($method === 'POST') {
        $raw = file_get_contents('php://input', false, null, 0, ILN_EDGE_MAX_BODY + 1);
        if ($raw === false) {
            ilnRespondEmpty(400);
            return;
        }
        if (strlen($raw) > ILN_EDGE_MAX_BODY) {
            ilnRespondEmpty(413);
            return;
        }
        $body = $raw;
    }

    $client = new ApiClient($config);
    $result = $client->forward($method, $path, $query, $body, $clientIp);

    /* Pesan 5xx backend bisa memuat detail internal (termasuk pesan seal
       server). Ganti dengan bentuk kosong yang netral. */
    if ($result['status'] >= 500) {
        ilnRespondEmpty(502);
        return;
    }

    $headers = [];
    $location = (string) $result['location'];
    if ($location !== '' && preg_match('#^(https?://|/)#i', $location) === 1) {
        $headers['Location'] = $location;
    }
    $retryAfter = (string) $result['retryAfter'];
    if (preg_match('/^[0-9]{1,5}$/', $retryAfter) === 1) {
        $headers['Retry-After'] = $retryAfter;
    }

    ilnRespondJson((int) $result['status'], (string) $result['body'], $headers);
}

try {
    ilnHandle();
} catch (Throwable $error) {
    /* Detail hanya ke log server; pengunjung mendapat bentuk netral. */
    error_log('iln-edge: ' . $error->getMessage());
    ilnRespondEmpty(502);
}
