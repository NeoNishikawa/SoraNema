<?php
declare(strict_types=1);

/* Backend palsu untuk smoke test edge. Tidak pernah dipakai produksi. */

$path = parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
$method = (string) ($_SERVER['REQUEST_METHOD'] ?? 'GET');

header('Content-Type: application/json; charset=utf-8');

if ($path === '/api/genres') {
    http_response_code(500);
    echo '{"error":"boom-internal"}';
    return;
}

if ($path === '/api/download') {
    header('Location: https://contoh.test/berkas', true, 302);
    return;
}

echo json_encode([
    'data' => [[
        'path' => $path,
        'method' => $method,
        'body' => (string) file_get_contents('php://input'),
        'edge' => (string) ($_SERVER['HTTP_X_ILN_EDGE'] ?? ''),
        'seal' => (string) ($_SERVER['HTTP_X_ILN_SEAL'] ?? ''),
        'forwardedFor' => (string) ($_SERVER['HTTP_X_FORWARDED_FOR'] ?? ''),
    ]],
    'total' => 1,
], JSON_UNESCAPED_SLASHES);
