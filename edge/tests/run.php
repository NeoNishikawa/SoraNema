<?php
declare(strict_types=1);

require __DIR__ . '/../src/Config.php';
require __DIR__ . '/../src/ApiClient.php';
require __DIR__ . '/../src/SealGuard.php';

use Iln\Edge\ApiClient;
use Iln\Edge\SealGuard;

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

function ilnThrows(string $label, callable $action): void
{
    try {
        $action();
    } catch (Throwable) {
        ilnCheck($label, true);
        return;
    }
    ilnCheck($label, false);
}

/* ---------- Allowlist rute ---------- */
$allowed = [
    ['/api/health', 'GET'],
    ['/api/catalog', 'GET'],
    ['/api/daily', 'GET'],
    ['/api/genres', 'GET'],
    ['/api/recommendations', 'GET'],
    ['/api/anime/naruto', 'GET'],
    ['/api/anime/naruto/downloads', 'GET'],
    ['/api/anime/naruto/episode-supplement', 'GET'],
    ['/api/streams/naruto-episode-1', 'GET'],
    ['/api/laporan-tautan', 'GET'],
    ['/api/laporan-tautan', 'POST'],
    ['/api/download', 'GET'],
    ['/api/daily', 'HEAD'],
];
foreach ($allowed as [$path, $method]) {
    ilnCheck("izinkan {$method} {$path}", ApiClient::isMethodAllowed($method, $path));
}

$rejected = [
    ['/api/daily', 'POST'],
    ['/api/daily', 'DELETE'],
    ['/api/laporan-tautan', 'PUT'],
    ['/api/admin', 'GET'],
    ['/api/health/', 'GET'],
    ['/api/../settings.js', 'GET'],
    ['/api//daily', 'GET'],
    ['/api/anime/naruto/../settings', 'GET'],
    ['/api/anime/naruto%2Fdownloads', 'GET'],
    ['/api/anime/', 'GET'],
    ['/api/anime/naruto/unknown', 'GET'],
];
foreach ($rejected as [$path, $method]) {
    ilnCheck("tolak {$method} {$path}", !ApiClient::isMethodAllowed($method, $path));
}

/* ---------- Sanitasi path ---------- */
ilnCheck('path normal dipertahankan', ApiClient::sanitizePath('/api/anime/naruto-ep-1') === '/api/anime/naruto-ep-1');
ilnThrows('path tanpa awalan / ditolak', static fn () => ApiClient::sanitizePath('api/daily'));
ilnThrows('path berpindah direktori ditolak', static fn () => ApiClient::sanitizePath('/api/../server.js'));
ilnThrows('path dengan persen ditolak', static fn () => ApiClient::sanitizePath('/api/%2e%2e/server.js'));
ilnThrows('path dengan backslash ditolak', static fn () => ApiClient::sanitizePath('/api\\daily'));
ilnThrows('path dengan dua slash ditolak', static fn () => ApiClient::sanitizePath('/api//daily'));
ilnThrows('path dengan query ditolak', static fn () => ApiClient::sanitizePath('/api/daily?x=1'));
ilnThrows('path dengan karakter kendali ditolak', static fn () => ApiClient::sanitizePath("/api/dai\x01ly"));

/* ---------- Sanitasi query ---------- */
ilnCheck('query normal dipertahankan', ApiClient::sanitizeQuery('q=naruto&page=2') === 'q=naruto&page=2');
ilnCheck('query kosong dipertahankan', ApiClient::sanitizeQuery('') === '');
ilnThrows('query dengan CRLF ditolak', static fn () => ApiClient::sanitizeQuery("q=a\r\nX-Bypass: 1"));
ilnThrows('query dengan CRLF ter-encode ditolak', static fn () => ApiClient::sanitizeQuery('q=a%0d%0aX-Bypass:1'));
ilnThrows('query dengan NUL ter-encode ditolak', static fn () => ApiClient::sanitizeQuery('q=a%00b'));
ilnThrows('query dengan karakter kendali ditolak', static fn () => ApiClient::sanitizeQuery("q=a\x01b"));

/* ---------- Tanda tangan edge ---------- */
$tokenA = ApiClient::edgeToken('rahasia', 'GET', '/api/daily', '', 1700000000);
$tokenB = ApiClient::edgeToken('rahasia', 'GET', '/api/daily', '', 1700000000);
$tokenC = ApiClient::edgeToken('rahasia', 'GET', '/api/daily', 'page=2', 1700000000);
ilnCheck('tanda tangan deterministik', $tokenA === $tokenB);
ilnCheck('tanda tangan berbeda untuk query berbeda', $tokenA !== $tokenC);
ilnCheck('format tanda tangan v1', preg_match('/^v1\.1700000000\.[0-9a-f]{64}$/', $tokenA) === 1);

/* ---------- Seal guard ---------- */
$enforce = new SealGuard('iln:abc', 'enforce');
ilnCheck('seal enforce menerima digest benar', $enforce->verify('iln:abc'));
ilnCheck('seal enforce menolak digest salah', !$enforce->verify('iln:abd'));
ilnCheck('seal enforce menolak header kosong', !$enforce->verify(''));
ilnCheck('seal enforce menolak header hilang', !$enforce->verify(null));
ilnCheck('seal enforce menolak header kepanjangan', !$enforce->verify(str_repeat('a', 129)));

$report = new SealGuard('iln:abc', 'report');
ilnCheck('seal report tetap melaporkan ketidakcocokan', !$report->verify('iln:abd'));

$off = new SealGuard('', 'off');
ilnCheck('seal off melewati pemeriksaan', $off->verify(null));

echo "\n{$passed} lulus, {$failed} gagal.\n";
exit($failed === 0 ? 0 : 1);
