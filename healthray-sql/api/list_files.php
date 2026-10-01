<?php
header('Content-Type: application/json');

/*
 * Multi-site root - lets this one File Browser list either this folder's
 * own PHP/HTML files or a sibling site's, instead of needing a byte-
 * identical copy of the tool per site. This never touches a database, so
 * the keys here are plain folder names, not WordPress DB keys - don't
 * confuse this with conn.php's $DATABASES.
 */
$SITES = [
    'healthray' => ['label' => 'Healthray', 'path' => realpath(__DIR__ . '/..'), 'url' => '.'],
    'botphonic' => ['label' => 'Botphonic', 'path' => realpath(__DIR__ . '/../../botphonic-sql'), 'url' => '../botphonic-sql'],
];
$DEFAULT_SITE = 'healthray';

function resolve_site_key($sites, $default)
{
    $key = $_GET['site'] ?? $_COOKIE['fb_site'] ?? null;
    return (is_string($key) && isset($sites[$key]) && $sites[$key]['path']) ? $key : $default;
}

// ─── ACTION: LIST AVAILABLE SITES (for the UI's Site switcher) ───────────────
if (($_GET['action'] ?? '') === 'sites') {
    $list = [];
    foreach ($SITES as $key => $cfg) {
        if (!$cfg['path']) continue; // skip a sibling folder that doesn't exist on this box
        $list[] = ['key' => $key, 'label' => $cfg['label'], 'url' => $cfg['url']];
    }
    echo json_encode([
        'sites'   => $list,
        'current' => resolve_site_key($SITES, $DEFAULT_SITE),
    ]);
    exit;
}

$siteKey = resolve_site_key($SITES, $DEFAULT_SITE);
$site = $SITES[$siteKey];
$base = $site['path'];

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
        // A folder that has its own index.html/index.php is a dashboard, not
        // just a container - the UI opens it directly (same URL Apache's own
        // DirectoryIndex would serve) instead of drilling into its file list.
        $hasIndex = file_exists($full . '/index.html') || file_exists($full . '/index.php');
        $items[] = ['name' => $file, 'path' => $relative, 'isDir' => true, 'hasIndex' => $hasIndex];
    } else {
        $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));

        if (in_array($ext, ['php', 'html', 'htm'])) {
            $items[] = ['name' => $file, 'path' => $relative, 'isDir' => false];
        }
    }
}

echo json_encode([
    'folder'   => $folder,
    'items'    => $items,
    'site'     => $siteKey,
    'url_base' => $site['url'],
]);
