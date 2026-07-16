<?php
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST');
header('Access-Control-Allow-Headers: Content-Type');

require __DIR__ . '/../conn.php';
$conn->set_charset("utf8mb4");

$action = $_GET['action'] ?? 'get_links';

// ─── Config ───────────────────────────────────────────────────────────────────
const CURL_TIMEOUT    = 10;
const MAX_REDIRECTS   = 5;
const USER_AGENT      = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const COOKIE_JAR      = '/tmp/url_checker_cookies.txt';
const BROWSER_HEADERS = [
    'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language: en-US,en;q=0.9',
    'Connection: keep-alive',
    'Upgrade-Insecure-Requests: 1',
    'Sec-Fetch-Dest: document',
    'Sec-Fetch-Mode: navigate',
    'Sec-Fetch-Site: none',
    'Sec-Fetch-User: ?1',
    'Cache-Control: max-age=0',
];

// ─── HELPER: unwrap an <a href="$url">text</a> → text (removes the link, keeps text) ──
function unwrap_anchor($content, $url)
{
    $pattern = '/<a\s[^>]*href=["\']' . preg_quote($url, '/') . '["\'][^>]*>(.*?)<\/a>/si';
    $result  = preg_replace($pattern, '$1', $content);
    return $result === null ? $content : $result;
}

// ─── HELPER: HTTP request (HEAD or GET) ───────────────────────────────────────
function makeHttpRequest(string $url, bool $headOnly): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_NOBODY         => $headOnly,
        CURLOPT_TIMEOUT        => CURL_TIMEOUT,
        CURLOPT_MAXREDIRS      => MAX_REDIRECTS,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_ENCODING       => '',           // Auto-handle gzip/br
        CURLOPT_COOKIEJAR      => COOKIE_JAR,
        CURLOPT_COOKIEFILE     => COOKIE_JAR,
        CURLOPT_USERAGENT      => USER_AGENT,
        CURLOPT_HTTPHEADER     => BROWSER_HEADERS,
    ]);

    curl_exec($ch);

    $result = [
        'status_code'    => curl_getinfo($ch, CURLINFO_HTTP_CODE),
        'final_url'      => curl_getinfo($ch, CURLINFO_EFFECTIVE_URL),
        'redirect_count' => curl_getinfo($ch, CURLINFO_REDIRECT_COUNT),
        'curl_error'     => curl_error($ch) ?: null,
    ];

    curl_close($ch);
    return $result;
}

// ─── HELPER: TCP/DNS check ────────────────────────────────────────────────────
function checkTcp(string $url): array
{
    $host   = parse_url($url, PHP_URL_HOST);
    $scheme = parse_url($url, PHP_URL_SCHEME);
    $port   = parse_url($url, PHP_URL_PORT) ?? ($scheme === 'https' ? 443 : 80);

    if (!checkdnsrr($host, 'A') && !checkdnsrr($host, 'AAAA')) {
        return ['alive' => false, 'reason' => 'DNS resolution failed'];
    }

    $socket = @fsockopen($host, $port, $errno, $errstr, 5);
    if ($socket) {
        fclose($socket);
        return ['alive' => true, 'host' => $host, 'port' => $port];
    }

    return ['alive' => false, 'reason' => $errstr];
}

// ─── HELPER: Status text ──────────────────────────────────────────────────────
function getStatusText(int $code): string
{
    $texts = [
        0   => 'No Response / Timeout',
        200 => 'OK',
        201 => 'Created',
        204 => 'No Content',
        301 => 'Moved Permanently',
        302 => 'Found',
        304 => 'Not Modified',
        307 => 'Temporary Redirect',
        308 => 'Permanent Redirect',
        400 => 'Bad Request',
        401 => 'Unauthorized',
        403 => 'Forbidden',
        404 => 'Not Found',
        405 => 'Method Not Allowed',
        429 => 'Too Many Requests',
        500 => 'Internal Server Error',
        502 => 'Bad Gateway',
        503 => 'Service Unavailable',
        504 => 'Gateway Timeout',
    ];
    return $texts[$code] ?? 'Unknown';
}

// ─── ACTION: GET ALL INTERNAL LINKS ───────────────────────────────────────────
if ($action === 'get_links') {
    $page    = max(1, intval($_GET['page'] ?? 1));
    $perPage = max(1, intval($_GET['perPage'] ?? 50));
    $offset  = ($page - 1) * $perPage;

    // Get site base URL from WordPress options
    $siteUrlRow = $conn->query("SELECT option_value FROM wp_options WHERE option_name = 'siteurl' LIMIT 1");
    $siteUrl    = '';
    if ($siteUrlRow && $row = $siteUrlRow->fetch_assoc()) {
        $siteUrl = rtrim($row['option_value'], '/');
    }

    // Count total published posts
    $countResult = $conn->query("SELECT COUNT(ID) AS total FROM wp_posts WHERE post_type = 'post' AND post_status = 'publish'");
    $totalPosts  = 0;
    if ($countResult) {
        $totalPosts = intval($countResult->fetch_assoc()['total'] ?? 0);
    }

    // Fetch posts with pagination
    $sql    = "SELECT ID, post_title, guid, post_content
               FROM wp_posts
               WHERE post_type = 'post' AND post_status = 'publish'
               ORDER BY ID ASC
               LIMIT {$perPage} OFFSET {$offset}";
    $result = $conn->query($sql);

    if (!$result) {
        http_response_code(500);
        echo json_encode(['status' => 'error', 'message' => $conn->error]);
        exit;
    }

    $allLinks = [];

    while ($row = $result->fetch_assoc()) {
        $postId      = $row['ID'];
        $postTitle   = $row['post_title'];
        $postContent = $row['post_content'];

        // Extract all <a href="...">text</a> from post content
        preg_match_all('/<a\s[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)<\/a>/si', $postContent, $matches, PREG_SET_ORDER);

        foreach ($matches as $match) {
            $href       = trim($match[1]);
            $anchorText = trim(strip_tags($match[2]));

            // Skip internal links
            $siteHost = parse_url($siteUrl, PHP_URL_HOST);
            $linkHost = parse_url($href, PHP_URL_HOST);
            if (empty($linkHost) || $linkHost === $siteHost) {
                continue;
            }

            // Skip empty, anchor-only, mailto, tel links
            if (empty($href) || str_starts_with($href, '#') || str_starts_with($href, 'mailto:') || str_starts_with($href, 'tel:')) {
                continue;
            }

            // Build absolute URL
            $absoluteUrl = str_starts_with($href, '/') ? $siteUrl . $href : $href;

            $allLinks[] = [
                'post_id'     => $postId,
                'post_title'  => $postTitle,
                'anchor_text' => $anchorText ?: '(no text)',
                'url'         => $absoluteUrl,
                'original'    => $href,
            ];
        }
    }

    // Remove duplicate URLs (keep unique url+post combos)
    $seen   = [];
    $unique = [];
    foreach ($allLinks as $link) {
        $key = $link['post_id'] . '||' . $link['url'];
        if (!isset($seen[$key])) {
            $seen[$key] = true;
            $unique[]   = $link;
        }
    }

    echo json_encode([
        'status'      => 'success',
        'site_url'    => $siteUrl,
        'total_posts' => $totalPosts,
        'page'        => $page,
        'per_page'    => $perPage,
        'total_pages' => (int) ceil($totalPosts / $perPage),
        'link_count'  => count($unique),
        'links'       => $unique,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

// ─── ACTION: CHECK LINK STATUS ────────────────────────────────────────────────
if ($action === 'check_status') {
    $url = trim($_GET['url'] ?? '');

    if (empty($url)) {
        echo json_encode(['status' => 'error', 'message' => 'No URL provided']);
        exit;
    }

    if (!filter_var($url, FILTER_VALIDATE_URL)) {
        echo json_encode(['status' => 'error', 'message' => 'Invalid URL format']);
        exit;
    }

    $startTime = microtime(true);

    // Step 1: HEAD request (fast, no body download)
    $result = makeHttpRequest($url, true);

    // Step 2: GET fallback if HEAD failed or blocked
    $methodUsed = 'HEAD';
    if (in_array($result['status_code'], [0, 403, 404, 405, 501])) {
        $result     = makeHttpRequest($url, false);
        $methodUsed = 'GET';
    }

    // Step 3: TCP/DNS fallback if both HTTP methods failed
    $tcp = null;
    if ($result['status_code'] === 0) {
        $tcp = checkTcp($url);
    }

    $statusCode = $result['status_code'];
    $elapsed    = round((microtime(true) - $startTime) * 1000);

    // is_up: 2xx/3xx = up | 4xx = up but blocked | 0 + tcp alive = server up
    $isUp = ($statusCode >= 200 && $statusCode < 500)
         || ($statusCode === 0 && ($tcp['alive'] ?? false));

    echo json_encode([
        'url'              => $url,
        'final_url'        => $result['final_url'],
        'status_code'      => $statusCode,
        'status_text'      => getStatusText($statusCode),
        'is_up'            => $isUp,
        'is_down'          => !$isUp,
        'is_redirect'      => ($result['redirect_count'] > 0),
        'redirect_count'   => $result['redirect_count'],
        'method_used'      => $methodUsed,
        'tcp_reachable'    => $tcp['alive'] ?? null,
        'response_time_ms' => $elapsed,
        'checked_at'       => date('c'),
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

// ─── ACTION: BULK CHECK STATUS ────────────────────────────────────────────────
if ($action === 'bulk_check_status') {
    $body = json_decode(file_get_contents('php://input'), true);
    $urls = $body['urls'] ?? [];

    if (empty($urls) || !is_array($urls)) {
        echo json_encode(['status' => 'error', 'message' => 'No URLs provided. Send JSON body: {"urls": [...]}']);
        exit;
    }

    $urls    = array_slice($urls, 0, 20); // Max 20 at once
    $results = [];

    foreach ($urls as $url) {
        $url       = trim($url);
        $startTime = microtime(true);

        if (!filter_var($url, FILTER_VALIDATE_URL)) {
            $results[] = ['url' => $url, 'status_code' => 0, 'status_text' => 'Invalid URL', 'is_up' => false];
            continue;
        }

        // HEAD → GET fallback
        $result     = makeHttpRequest($url, true);
        $methodUsed = 'HEAD';
        if (in_array($result['status_code'], [0, 403, 404, 405, 501])) {
            $result     = makeHttpRequest($url, false);
            $methodUsed = 'GET';
        }

        // TCP fallback
        $tcp = null;
        if ($result['status_code'] === 0) {
            $tcp = checkTcp($url);
        }

        $statusCode = $result['status_code'];
        $isUp       = ($statusCode >= 200 && $statusCode < 500)
                   || ($statusCode === 0 && ($tcp['alive'] ?? false));

        $results[] = [
            'url'              => $url,
            'final_url'        => $result['final_url'],
            'status_code'      => $statusCode,
            'status_text'      => getStatusText($statusCode),
            'is_up'            => $isUp,
            'is_down'          => !$isUp,
            'is_redirect'      => ($result['redirect_count'] > 0),
            'redirect_count'   => $result['redirect_count'],
            'method_used'      => $methodUsed,
            'tcp_reachable'    => $tcp['alive'] ?? null,
            'response_time_ms' => round((microtime(true) - $startTime) * 1000),
            'checked_at'       => date('c'),
        ];
    }

    $upCount   = count(array_filter($results, fn($r) => $r['is_up']));
    $downCount = count($results) - $upCount;

    echo json_encode([
        'status'     => 'success',
        'total'      => count($results),
        'up'         => $upCount,
        'down'       => $downCount,
        'results'    => $results,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

// ─── ACTION: UPDATE SINGLE LINK IN POST ───────────────────────────────────────
if ($action === 'update_link' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $body   = json_decode(file_get_contents('php://input'), true);
    $postId = intval($body['post_id'] ?? 0);
    $oldUrl = trim($body['old_url'] ?? '');
    $newUrl = trim($body['new_url'] ?? '');

    if (!$postId || !$oldUrl || !$newUrl) {
        echo json_encode(['status' => 'error', 'message' => 'Missing post_id, old_url, or new_url']);
        exit;
    }

    $stmt = $conn->prepare("SELECT post_content FROM wp_posts WHERE ID = ?");
    $stmt->bind_param('i', $postId);
    $stmt->execute();
    $res = $stmt->get_result();
    if (!$res || $res->num_rows === 0) {
        echo json_encode(['status' => 'error', 'message' => 'Post not found']);
        exit;
    }
    $content = $res->fetch_assoc()['post_content'];
    $stmt->close();

    $newContent = str_replace(
        ['href="' . $oldUrl . '"', "href='" . $oldUrl . "'"],
        ['href="' . $newUrl . '"', "href='" . $newUrl . "'"],
        $content
    );

    if ($newContent === $content) {
        echo json_encode(['status' => 'no_change', 'message' => 'URL not found in post content']);
        exit;
    }

    $stmt2 = $conn->prepare("UPDATE wp_posts SET post_content = ?, post_modified = NOW(), post_modified_gmt = UTC_TIMESTAMP() WHERE ID = ?");
    $stmt2->bind_param('si', $newContent, $postId);
    $stmt2->execute();
    $affected = $stmt2->affected_rows;
    $stmt2->close();

    echo json_encode([
        'status'  => 'success',
        'message' => "Updated {$affected} post(s)",
        'post_id' => $postId,
        'old_url' => $oldUrl,
        'new_url' => $newUrl,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// ─── ACTION: REMOVE SINGLE LINK FROM POST ─────────────────────────────────────
if ($action === 'remove_link' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $body   = json_decode(file_get_contents('php://input'), true);
    $postId = intval($body['post_id'] ?? 0);
    $oldUrl = trim($body['old_url'] ?? '');

    if (!$postId || !$oldUrl) {
        echo json_encode(['status' => 'error', 'message' => 'Missing post_id or old_url']);
        exit;
    }

    $stmt = $conn->prepare("SELECT post_content FROM wp_posts WHERE ID = ?");
    $stmt->bind_param('i', $postId);
    $stmt->execute();
    $res = $stmt->get_result();
    if (!$res || $res->num_rows === 0) {
        echo json_encode(['status' => 'error', 'message' => 'Post not found']);
        exit;
    }
    $content = $res->fetch_assoc()['post_content'];
    $stmt->close();

    $newContent = unwrap_anchor($content, $oldUrl);

    if ($newContent === $content) {
        echo json_encode(['status' => 'no_change', 'message' => 'Link not found in post content']);
        exit;
    }

    $stmt2 = $conn->prepare("UPDATE wp_posts SET post_content = ?, post_modified = NOW(), post_modified_gmt = UTC_TIMESTAMP() WHERE ID = ?");
    $stmt2->bind_param('si', $newContent, $postId);
    $stmt2->execute();
    $affected = $stmt2->affected_rows;
    $stmt2->close();

    echo json_encode([
        'status'  => 'success',
        'message' => "Removed link from {$affected} post(s)",
        'post_id' => $postId,
        'old_url' => $oldUrl,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// ─── ACTION: BULK REMOVE LINKS ────────────────────────────────────────────────
if ($action === 'bulk_remove' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $body     = json_decode(file_get_contents('php://input'), true);
    $removals = $body['removals'] ?? [];

    if (empty($removals)) {
        echo json_encode(['status' => 'error', 'message' => 'No removals provided']);
        exit;
    }

    $byPost = [];
    foreach ($removals as $r) {
        $pid = intval($r['post_id'] ?? 0);
        $url = trim($r['old_url'] ?? '');
        if (!$pid || !$url) continue;
        $byPost[$pid][] = $url;
    }

    $results = [];
    $success = 0;
    $failed  = 0;

    foreach ($byPost as $postId => $urls) {
        $stmt = $conn->prepare("SELECT post_content FROM wp_posts WHERE ID = ?");
        $stmt->bind_param('i', $postId);
        $stmt->execute();
        $res = $stmt->get_result();
        if (!$res || $res->num_rows === 0) {
            foreach ($urls as $u) $results[] = ['post_id' => $postId, 'old_url' => $u, 'status' => 'error', 'reason' => 'post not found'];
            $failed += count($urls);
            $stmt->close();
            continue;
        }
        $content = $res->fetch_assoc()['post_content'];
        $stmt->close();

        $newContent = $content;
        foreach ($urls as $u) {
            $newContent = unwrap_anchor($newContent, $u);
        }

        if ($newContent === $content) {
            foreach ($urls as $u) $results[] = ['post_id' => $postId, 'old_url' => $u, 'status' => 'no_change'];
            continue;
        }

        $stmt2 = $conn->prepare("UPDATE wp_posts SET post_content = ?, post_modified = NOW(), post_modified_gmt = UTC_TIMESTAMP() WHERE ID = ?");
        $stmt2->bind_param('si', $newContent, $postId);
        $stmt2->execute();
        $stmt2->close();

        foreach ($urls as $u) $results[] = ['post_id' => $postId, 'old_url' => $u, 'status' => 'removed'];
        $success += count($urls);
    }

    echo json_encode([
        'status'  => 'success',
        'total'   => count($removals),
        'removed' => $success,
        'failed'  => $failed,
        'results' => $results,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// ─── ACTION: BULK UPDATE LINKS ────────────────────────────────────────────────
if ($action === 'bulk_update' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $body    = json_decode(file_get_contents('php://input'), true);
    $updates = $body['updates'] ?? [];

    if (empty($updates)) {
        echo json_encode(['status' => 'error', 'message' => 'No updates provided']);
        exit;
    }

    $results = [];
    $success = 0;
    $failed  = 0;

    foreach ($updates as $update) {
        $postId = intval($update['post_id'] ?? 0);
        $oldUrl = trim($update['old_url'] ?? '');
        $newUrl = trim($update['new_url'] ?? '');

        if (!$postId || !$oldUrl || !$newUrl) {
            $results[] = ['post_id' => $postId, 'status' => 'skipped', 'reason' => 'missing data'];
            $failed++;
            continue;
        }

        $stmt = $conn->prepare("SELECT post_content FROM wp_posts WHERE ID = ?");
        $stmt->bind_param('i', $postId);
        $stmt->execute();
        $res = $stmt->get_result();
        if (!$res || $res->num_rows === 0) {
            $results[] = ['post_id' => $postId, 'status' => 'error', 'reason' => 'post not found'];
            $failed++;
            $stmt->close();
            continue;
        }
        $content = $res->fetch_assoc()['post_content'];
        $stmt->close();

        $newContent = str_replace(
            ['href="' . $oldUrl . '"', "href='" . $oldUrl . "'"],
            ['href="' . $newUrl . '"', "href='" . $newUrl . "'"],
            $content
        );

        if ($newContent === $content) {
            $results[] = ['post_id' => $postId, 'old_url' => $oldUrl, 'status' => 'no_change'];
            continue;
        }

        $stmt2 = $conn->prepare("UPDATE wp_posts SET post_content = ?, post_modified = NOW(), post_modified_gmt = UTC_TIMESTAMP() WHERE ID = ?");
        $stmt2->bind_param('si', $newContent, $postId);
        $stmt2->execute();
        $stmt2->close();

        $results[] = ['post_id' => $postId, 'old_url' => $oldUrl, 'new_url' => $newUrl, 'status' => 'updated'];
        $success++;
    }

    echo json_encode([
        'status'  => 'success',
        'total'   => count($updates),
        'updated' => $success,
        'failed'  => $failed,
        'results' => $results,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

echo json_encode(['status' => 'error', 'message' => 'Unknown action']);