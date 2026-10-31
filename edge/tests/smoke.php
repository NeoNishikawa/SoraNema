<?php
declare(strict_types=1);

/* Smoke test lapisan tepi: dua server PHP sungguhan (backend palsu dan
   edge), lalu request HTTP nyata. Tidak menyentuh sumber anime. */

$passed = 0;
$failed = 0;

function ilnCheck(string $label, bool $ok): void
{
    global $passed, $failed;
    if ($ok) {
        $passed++;
        echo "LULUS: {$label}\n";
        return;
    }
    $failed++;
    echo "GAGAL: {$label}\n";
}

function ilnFreePort(): int
{
    $socket = stream_socket_server('tcp://127.0.0.1:0', $errno, $errstr);
    if ($socket === false) {
        throw new RuntimeException("Tidak bisa mencari port: {$errstr}");
    }
    $name = stream_socket_get_name($socket, false);
    fclose($socket);
    if (!is_string($name)) {
        throw new RuntimeException('Nama socket tidak terbaca');
    }
    $separator = strrpos($name, ':');
    return (int) substr($name, $separator + 1);
}

function ilnWaitPort(int $port, string $label): void
{
    $deadline = microtime(true) + 10;
    while (microtime(true) < $deadline) {
        $socket = @fsockopen('127.0.0.1', $port, $errno, $errstr, 0.2);
        if (is_resource($socket)) {
            fclose($socket);
            return;
        }
        usleep(50_000);
    }
    throw new RuntimeException("{$label} tidak siap di port {$port}");
}

function ilnStart(array $command, array $env, string $log): array
{
    $descriptors = [
        0 => ['pipe', 'r'],
        1 => ['file', $log, 'a'],
        2 => ['file', $log, 'a'],
    ];
    $pipes = [];
    $process = proc_open($command, $descriptors, $pipes, dirname(__DIR__), $env, ['bypass_shell' => true]);
    if (!is_resource($process)) {
        throw new RuntimeException('Gagal menjalankan: ' . implode(' ', $command));
    }
    if (isset($pipes[0]) && is_resource($pipes[0])) {
        fclose($pipes[0]);
    }
    return [$process, $pipes];
}

function ilnRequest(string $url, array $headers = [], ?string $body = null, string $method = 'GET'): array
{
    $responseHeaders = [];
    $curl = curl_init($url);
    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT_MS => 2000,
        CURLOPT_TIMEOUT_MS => 5000,
        CURLOPT_PROXY => '',
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_HEADERFUNCTION => static function ($curl, string $line) use (&$responseHeaders): int {
            $separator = strpos($line, ':');
            if ($separator !== false) {
                $responseHeaders[strtolower(trim(substr($line, 0, $separator)))] = trim(substr($line, $separator + 1));
            }
            return strlen($line);
        },
    ]);
    if ($method === 'POST') {
        curl_setopt($curl, CURLOPT_POST, true);
        curl_setopt($curl, CURLOPT_POSTFIELDS, $body ?? '');
    }
    $result = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    $error = curl_error($curl);
    unset($curl);
    if ($result === false) {
        throw new RuntimeException('HTTP gagal: ' . $error);
    }
    return ['status' => $status, 'body' => (string) $result, 'headers' => $responseHeaders];
}

$backendPort = ilnFreePort();
$edgePort = ilnFreePort();
$backendLog = (string) tempnam(sys_get_temp_dir(), 'iln-edge-backend-');
$edgeLog = (string) tempnam(sys_get_temp_dir(), 'iln-edge-server-');
$backendProcess = null;
$edgeProcess = null;
$root = dirname(__DIR__);

try {
    $baseEnv = getenv();
    if (!is_array($baseEnv)) {
        $baseEnv = [];
    }

    [$backendProcess] = ilnStart(
        [PHP_BINARY, '-S', "127.0.0.1:{$backendPort}", __DIR__ . '/stub-backend.php'],
        $baseEnv,
        $backendLog,
    );
    ilnWaitPort($backendPort, 'backend palsu');

    [$edgeProcess] = ilnStart(
        [PHP_BINARY, '-S', "127.0.0.1:{$edgePort}", $root . '/public/index.php'],
        array_merge($baseEnv, [
            'ILN_BACKEND_URL' => "http://127.0.0.1:{$backendPort}",
            'ILN_SEAL_MODE' => 'enforce',
            'ILN_SEAL_DIGEST' => 'iln:uji',
            'ILN_EDGE_SECRET' => 'rahasia-uji',
            'ILN_UPSTREAM_TIMEOUT_MS' => '3000',
        ]),
        $edgeLog,
    );
    ilnWaitPort($edgePort, 'edge');

    $edgeUrl = "http://127.0.0.1:{$edgePort}";
    $valid = ['X-ILN-Seal: iln:uji'];

    /* ---------- Seal valid: data diteruskan ---------- */
    $response = ilnRequest("{$edgeUrl}/api/daily", $valid);
    $payload = json_decode($response['body'], true);
    ilnCheck('seal valid: status 200', $response['status'] === 200);
    ilnCheck('seal valid: data diteruskan', ($payload['data'][0]['path'] ?? '') === '/api/daily');
    ilnCheck('seal valid: edge menandatangani request', str_starts_with((string) ($payload['data'][0]['edge'] ?? ''), 'v1.'));
    ilnCheck('seal valid: IP asli diteruskan', ($payload['data'][0]['forwardedFor'] ?? '') === '127.0.0.1');
    ilnCheck('respons tanpa X-Powered-By', !isset($response['headers']['x-powered-by']));
    ilnCheck('respons no-store', ($response['headers']['cache-control'] ?? '') === 'no-store');

    /* ---------- Seal salah dan hilang: bentuk kosong yang sama ---------- */
    $wrong = ilnRequest("{$edgeUrl}/api/daily", ['X-ILN-Seal: iln:salah']);
    ilnCheck('seal salah: status 200, bukan 403', $wrong['status'] === 200);
    ilnCheck('seal salah: bentuk kosong biasa', $wrong['body'] === '{"data":[],"total":0}');
    ilnCheck(
        'seal salah: tidak membocorkan sebab',
        stripos($wrong['body'], 'seal') === false
        && stripos($wrong['body'], 'kunci') === false
        && stripos($wrong['body'], 'invalid') === false,
    );
    ilnCheck('seal salah: tanpa X-Powered-By', !isset($wrong['headers']['x-powered-by']));

    $missing = ilnRequest("{$edgeUrl}/api/daily");
    ilnCheck('tanpa seal: bentuk kosong biasa', $missing['status'] === 200 && $missing['body'] === '{"data":[],"total":0}');

    /* ---------- Rute di luar allowlist ---------- */
    $unknown = ilnRequest("{$edgeUrl}/api/admin", $valid);
    ilnCheck('rute tak dikenal: 404', $unknown['status'] === 404);
    ilnCheck('rute tak dikenal: body netral', $unknown['body'] === 'Not found');
    ilnCheck('rute tak dikenal: tidak menyebut allowlist', stripos($unknown['body'], 'allow') === false);

    $traversal = ilnRequest("{$edgeUrl}/api/%2e%2e/server.js", $valid);
    ilnCheck('traversal: 404', $traversal['status'] === 404);

    /* ---------- Backend 500 tidak membocorkan pesan ---------- */
    $upstreamError = ilnRequest("{$edgeUrl}/api/genres", $valid);
    ilnCheck('backend 500: status 502', $upstreamError['status'] === 502);
    ilnCheck('backend 500: body netral', $upstreamError['body'] === '{"data":[],"total":0}');
    ilnCheck('backend 500: pesan internal tidak bocor', stripos($upstreamError['body'], 'boom') === false);

    /* ---------- POST diteruskan ---------- */
    $post = ilnRequest(
        "{$edgeUrl}/api/laporan-tautan",
        array_merge($valid, ['Content-Type: application/json']),
        '{"jenis":"unduhan"}',
        'POST',
    );
    $postPayload = json_decode($post['body'], true);
    ilnCheck('POST laporan: status 200', $post['status'] === 200);
    ilnCheck('POST laporan: metode diteruskan', ($postPayload['data'][0]['method'] ?? '') === 'POST');
    ilnCheck('POST laporan: body diteruskan', ($postPayload['data'][0]['body'] ?? '') === '{"jenis":"unduhan"}');

    /* ---------- Redirect unduhan diteruskan ---------- */
    $download = ilnRequest("{$edgeUrl}/api/download", $valid);
    ilnCheck('download: status 302', $download['status'] === 302);
    ilnCheck('download: Location diteruskan', ($download['headers']['location'] ?? '') === 'https://contoh.test/berkas');
} catch (Throwable $error) {
    ilnCheck('smoke test berjalan: ' . $error->getMessage(), false);
} finally {
    foreach ([$edgeProcess, $backendProcess] as $process) {
        if (is_resource($process)) {
            proc_terminate($process);
            proc_close($process);
        }
    }
}

if ($failed > 0) {
    echo "\n--- log edge ---\n" . (string) @file_get_contents($edgeLog) . "\n";
    echo "--- log backend ---\n" . (string) @file_get_contents($backendLog) . "\n";
}
@unlink($edgeLog);
@unlink($backendLog);

echo "\n{$passed} lulus, {$failed} gagal.\n";
exit($failed === 0 ? 0 : 1);
