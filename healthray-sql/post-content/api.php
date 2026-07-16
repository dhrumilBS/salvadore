<?php
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST');
header('Access-Control-Allow-Headers: Content-Type');

require __DIR__ . '/../conn.php';
$conn->set_charset("utf8mb4");

$action = $_GET['action'] ?? 'get_links';

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

            // if (
            //     $siteUrl &&
            //     !str_starts_with($href, $siteUrl) &&
            //     !str_starts_with($href, '/')
            // ) {
            //     continue;
            // }

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
    $seen  = [];
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

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => false,   // Don't follow — we want the raw 3xx
        CURLOPT_NOBODY         => true,    // HEAD request
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_USERAGENT      => 'Mozilla/5.0 (compatible; LinkChecker/1.0)',
        CURLOPT_SSL_VERIFYPEER => false,
    ]);

    curl_exec($ch);
    $statusCode  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $redirectUrl = curl_getinfo($ch, CURLINFO_REDIRECT_URL);
    curl_close($ch);

    // If redirect URL is relative, resolve it
    if ($redirectUrl && !preg_match('/^https?:\/\//', $redirectUrl)) {
        $parsed      = parse_url($url);
        $redirectUrl = $parsed['scheme'] . '://' . $parsed['host'] . $redirectUrl;
    }

    echo json_encode([
        'url'          => $url,
        'status_code'  => $statusCode,
        'is_redirect'  => ($statusCode >= 300 && $statusCode < 400),
        'redirect_url' => $redirectUrl ?: null,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

// ─── ACTION: UPDATE SINGLE LINK IN POST ───────────────────────────────────────
if ($action === 'update_link' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $body    = json_decode(file_get_contents('php://input'), true);
    $postId  = intval($body['post_id'] ?? 0);
    $oldUrl  = trim($body['old_url'] ?? '');
    $newUrl  = trim($body['new_url'] ?? '');

    if (!$postId || !$oldUrl || !$newUrl) {
        echo json_encode(['status' => 'error', 'message' => 'Missing post_id, old_url, or new_url']);
        exit;
    }

    // Fetch current content
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

    // Replace old URL with new URL in href attributes
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
        'status'   => 'success',
        'message'  => "Updated {$affected} post(s)",
        'post_id'  => $postId,
        'old_url'  => $oldUrl,
        'new_url'  => $newUrl,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// ─── ACTION: BULK UPDATE LINKS ────────────────────────────────────────────────
if ($action === 'bulk_update' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $body    = json_decode(file_get_contents('php://input'), true);
    $updates = $body['updates'] ?? [];  // [ { post_id, old_url, new_url }, ... ]

    if (empty($updates)) {
        echo json_encode(['status' => 'error', 'message' => 'No updates provided']);
        exit;
    }

    $results  = [];
    $success  = 0;
    $failed   = 0;

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
        'status'        => 'success',
        'total'         => count($updates),
        'updated'       => $success,
        'failed'        => $failed,
        'results'       => $results,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

echo json_encode(['status' => 'error', 'message' => 'Unknown action']);
