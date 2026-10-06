<?php
header('Content-Type: application/json; charset=utf-8');

function fail($msg, $code = 400)
{
    http_response_code($code);
    echo json_encode(['status' => false, 'msg' => $msg]);
    exit;
}

function fetchUrl($url)
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS      => 5,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT        => 60,
        CURLOPT_USERAGENT      => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ImageDownloader/1.0',
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
    ]);
    $data   = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($data === false || $status >= 400) {
        return false;
    }
    return $data;
}

// Resolve a possibly-relative URL against the page URL
function resolveUrl($base, $rel)
{
    $rel = trim($rel);
    if ($rel === '' || stripos($rel, 'data:') === 0 || stripos($rel, 'javascript:') === 0) {
        return null;
    }
    if (preg_match('#^https?://#i', $rel)) {
        return $rel;
    }
    $p = parse_url($base);
    if (!isset($p['scheme'], $p['host'])) {
        return null;
    }
    $origin = $p['scheme'] . '://' . $p['host'] . (isset($p['port']) ? ':' . $p['port'] : '');

    if (strpos($rel, '//') === 0) {
        return $p['scheme'] . ':' . $rel;
    }
    if ($rel[0] === '/') {
        return $origin . $rel;
    }

    $path = $p['path'] ?? '/';
    $dir  = (substr($path, -1) === '/') ? $path : substr($path, 0, strrpos($path, '/') + 1);

    // normalize ./ and ../
    $parts = [];
    foreach (explode('/', $dir . $rel) as $seg) {
        if ($seg === '' || $seg === '.') continue;
        if ($seg === '..') {
            array_pop($parts);
        } else {
            $parts[] = $seg;
        }
    }
    return $origin . '/' . implode('/', $parts);
}

// Where to save the image, relative to the chosen directory.
// Same host: keep the path relative to the page's folder (falls back to full site path).
// Other host: external/<host>/<path>
function relativeSavePath($pageUrl, $imgUrl)
{
    $pp = parse_url($pageUrl);
    $ip = parse_url($imgUrl);

    $ipath = ltrim($ip['path'] ?? '', '/');
    if ($ipath === '' || substr($ipath, -1) === '/') {
        return null;
    }

    if (strtolower($ip['host'] ?? '') !== strtolower($pp['host'] ?? '')) {
        return 'external/' . ($ip['host'] ?? 'unknown') . '/' . $ipath;
    }

    $pagePath = $pp['path'] ?? '/';
    $pageDir  = (substr($pagePath, -1) === '/') ? $pagePath : substr($pagePath, 0, strrpos($pagePath, '/') + 1);
    $pageDir  = ltrim($pageDir, '/');

    if ($pageDir !== '' && strpos($ipath, $pageDir) === 0) {
        return substr($ipath, strlen($pageDir));
    }
    return $ipath;
}

// Strip anything dangerous out of a save path (no .., no drive letters, no leading slash)
function sanitizeRelPath($path)
{
    $path = str_replace('\\', '/', $path);
    $path = preg_replace('#\?.*$#', '', $path);      // drop query string
    $path = preg_replace('/[^A-Za-z0-9_\-.\/ ]/', '', $path);
    $parts = [];
    foreach (explode('/', $path) as $seg) {
        if ($seg === '' || $seg === '.' || $seg === '..') continue;
        $parts[] = $seg;
    }
    return implode('/', $parts);
}

$action = $_POST['action'] ?? '';

/* ---------------------------------------------------------
 * ACTION: scan — fetch the page and list every image on it
 * --------------------------------------------------------- */
if ($action === 'scan') {

    $pageUrl = trim($_POST['site_url'] ?? '');
    if ($pageUrl === '' || !preg_match('#^https?://#i', $pageUrl)) {
        fail('Please enter a valid page URL starting with http:// or https://');
    }

    $html = fetchUrl($pageUrl);
    if ($html === false) {
        fail('Could not load the page. Check the URL and your internet connection.', 502);
    }

    $found = [];

    $doc = new DOMDocument();
    libxml_use_internal_errors(true);
    $doc->loadHTML($html);
    libxml_clear_errors();

    // <img> src + lazy-load attributes
    foreach ($doc->getElementsByTagName('img') as $img) {
        foreach (['src', 'data-src', 'data-lazy-src', 'data-original', 'data-bg'] as $attr) {
            if ($img->hasAttribute($attr)) {
                $found[] = $img->getAttribute($attr);
            }
        }
        if ($img->hasAttribute('srcset')) {
            foreach (explode(',', $img->getAttribute('srcset')) as $cand) {
                $found[] = trim(explode(' ', trim($cand))[0]);
            }
        }
    }

    // <source srcset> inside <picture>
    foreach ($doc->getElementsByTagName('source') as $src) {
        if ($src->hasAttribute('srcset')) {
            foreach (explode(',', $src->getAttribute('srcset')) as $cand) {
                $found[] = trim(explode(' ', trim($cand))[0]);
            }
        }
    }

    // CSS backgrounds: url(...) in style attributes and <style> blocks
    if (preg_match_all('#url\(\s*[\'"]?([^\'")]+)[\'"]?\s*\)#i', $html, $m)) {
        foreach ($m[1] as $cssUrl) {
            $found[] = $cssUrl;
        }
    }

    // Resolve, filter to image extensions, dedupe
    $exts   = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico'];
    $images = [];
    foreach ($found as $raw) {
        $abs = resolveUrl($pageUrl, $raw);
        if ($abs === null) continue;

        $ext = strtolower(pathinfo(parse_url($abs, PHP_URL_PATH) ?? '', PATHINFO_EXTENSION));
        if (!in_array($ext, $exts)) continue;

        $rel = relativeSavePath($pageUrl, $abs);
        if ($rel === null) continue;

        $images[$abs] = ['url' => $abs, 'path' => sanitizeRelPath($rel)];
    }
    $images = array_values($images);

    echo json_encode([
        'status' => true,
        'count'  => count($images),
        'images' => $images,
        'msg'    => count($images) . ' image(s) found on the page',
    ]);
    exit;
}

/* ---------------------------------------------------------
 * ACTION: download — save one image into the chosen directory
 * --------------------------------------------------------- */
if ($action === 'download') {

    $imgUrl  = trim($_POST['img_url'] ?? '');
    $relPath = sanitizeRelPath($_POST['rel_path'] ?? '');
    $saveDir = trim($_POST['path_to_save'] ?? '');
    $saveDir = trim(preg_replace('/[^A-Za-z0-9_\-\/]/', '', str_replace('\\', '/', $saveDir)), '/');
    $saveDir = sanitizeRelPath($saveDir);

    if ($imgUrl === '' || !preg_match('#^https?://#i', $imgUrl)) fail('Invalid image URL');
    if ($relPath === '') fail('Invalid save path');
    if ($saveDir === '') fail('Please enter a directory name to save into');

    $localPath = './' . $saveDir . '/' . $relPath;
    $localDir  = dirname($localPath);

    if (file_exists($localPath)) {
        echo json_encode(['status' => true, 'existed' => true, 'local' => $localPath, 'msg' => 'Already exists']);
        exit;
    }

    if (!is_dir($localDir) && !mkdir($localDir, 0777, true)) {
        fail("Could not create directory $localDir", 500);
    }

    $data = fetchUrl($imgUrl);
    if ($data === false) {
        fail("Could not download $imgUrl", 502);
    }

    if (file_put_contents($localPath, $data) === false) {
        fail("Could not save file to $localPath", 500);
    }

    echo json_encode([
        'status'  => true,
        'existed' => false,
        'local'   => $localPath,
        'size'    => strlen($data),
        'msg'     => 'Image saved',
    ]);
    exit;
}

fail('Unknown action');
