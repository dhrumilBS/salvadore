<?php
header('Content-Type: application/json');
$base = realpath('../');
$folder = $_GET['folder'] ?? '.';
$path = realpath($base . '/' . $folder);
if (!$path || strpos($path, $base) !== 0) {
    echo json_encode(['error' => 'Invalid path']);
    exit;
}

$scan = scandir($path);
$items = [];
foreach ($scan as $file) {
    if ($file == '.' || $file == '..') {
        continue;
    }

    $full = $path . '/' . $file;
    $relative = trim(($folder == '.' ? '' : $folder) . '/' . $file, '/');

    if (is_dir($full)) {
        $items[] = ['name' => $file, 'path' => $relative, 'isDir' => true];
    } else {
        $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));

        if (in_array($ext, ['php', 'html', 'htm'])) {
            $items[] = ['name' => $file, 'path' => $relative, 'isDir' => false];
        }
    }
}

echo json_encode([
    'folder' => $folder,
    'items' => $items
]);