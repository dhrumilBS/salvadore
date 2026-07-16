<?php
$folder = isset($_GET['folder']) ? $_GET['folder'] : '.';
$format = isset($_GET['format']) ? $_GET['format'] : '';
$folder = trim($folder);

$resolved = realpath($folder);
if ($resolved === false || !is_dir($resolved)) {
    if ($format === 'json') {
        header('Content-Type: application/json');
        echo json_encode(['error' => 'Invalid folder']);
    } else {
        echo "Invalid folder";
    }
    exit;
}

$contents = array_values(array_diff(scandir($resolved), ['.', '..']));
$items = [];
foreach ($contents as $item) {
    $fullPath = $resolved . DIRECTORY_SEPARATOR . $item;
    $relativePath = str_replace('\\', '/', trim($folder . '/' . $item, '/'));
    $items[] = [
        'name' => $item,
        'path' => $relativePath,
        'isDir' => is_dir($fullPath),
    ];
}

if ($format === 'json') {
    header('Content-Type: application/json');
    echo json_encode(['folder' => $folder, 'items' => $items]);
    exit;
}

echo "<ul class='file-list'>";
foreach ($items as $item) {
    if ($item['isDir']) {
        echo "<li class='file-item'>📁 <a href='?folder={$item['path']}'>" . htmlspecialchars($item['name']) . "</a></li>";
    } else {
        echo "<li class='file-item'>📄 <a href='{$item['path']}' target='_blank'>" . htmlspecialchars($item['name']) . "</a></li>";
    }
}
echo "</ul>";
