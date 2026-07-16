<?php

header('Content-Type: application/json');

$logFile = __DIR__ . '/access-history.json';

$data = json_decode(file_get_contents('php://input'), true);

function getClientIP()
{
    foreach ([
        'HTTP_CF_CONNECTING_IP',
        'HTTP_X_FORWARDED_FOR',
        'HTTP_CLIENT_IP',
        'REMOTE_ADDR'
    ] as $key) {
        if (!empty($_SERVER[$key])) {
            return trim(explode(',', $_SERVER[$key])[0]);
        }
    }

    return 'Unknown';
}

$entry = [
    'time'       => date('Y-m-d H:i:s'),
    'ip'         => getClientIP(),
    'url'        => $data['url'] ?? '',
    'userAgent'  => $data['userAgent'] ?? '',
    'referrer'   => $data['referrer'] ?? '',
];

$history = [];

if (file_exists($logFile)) {
    $history = json_decode(file_get_contents($logFile), true);

    if (!is_array($history)) {
        $history = [];
    }
}

$history[] = $entry;

file_put_contents(
    $logFile,
    json_encode($history, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES),
    LOCK_EX
);

echo json_encode([
    'success' => true
]);