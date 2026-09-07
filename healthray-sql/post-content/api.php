<?php
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST');
header('Access-Control-Allow-Headers: Content-Type');

require __DIR__ . '/../conn.php';
$conn->set_charset("utf8mb4");

$action = $_GET['action'] ?? 'get_links';

// Internal/plumbing post types that never hold editorial link content (form
// builders, design-library assets, ACF field definitions, etc.) — excluded
// from the selectable list so the UI only offers real content types.
const SYSTEM_POST_TYPES = [
    'attachment', 'revision', 'nav_menu_item', 'acf-field', 'acf-field-group',
    'acf-post-type', 'acf-ui-options-page', 'elementor_library', 'elementor_icons',
    'elementor_font', 'custom_css', 'cf7_to_any_api', 'wpcf7_contact_form',
    'option-tree', 'customize_changeset', 'wp_global_styles', 'wp_block',
    'wp_navigation', 'aiosrs-schema', 'frm_styles', 'frm_form_actions',
    'wpcode', 'wpforms', 'themo_portfolio', 'e-landing-page',
];

// Every published post_type that isn't plumbing — the universe of types the
// UI is allowed to request a scan over. Untrusted "types" input is always
// intersected against this before touching SQL.
function selectable_post_types($conn)
{
    $types = [];
    $r = $conn->query("SELECT post_type, COUNT(*) c FROM wp_posts WHERE post_status = 'publish' GROUP BY post_type ORDER BY c DESC");
    if ($r) {
        while ($row = $r->fetch_assoc()) {
            if (!in_array($row['post_type'], SYSTEM_POST_TYPES, true)) {
                $types[] = ['post_type' => $row['post_type'], 'count' => (int) $row['c']];
            }
        }
    }
    return $types;
}

// ─── ACTION: LIST SELECTABLE POST TYPES (for the UI's type picker) ───────────
if ($action === 'post_types') {
    echo json_encode([
        'status'     => 'success',
        'post_types' => selectable_post_types($conn),
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// Pull every <a href="...">text</a> out of one HTML blob and classify each
// as internal/external against the site host. Shared by post_content and
// by FAQ answer fields (which live in postmeta, not post_content).
function extract_links_from_html($html, $siteUrl, $siteHost)
{
    $links = [];
    preg_match_all('/<a\s[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)<\/a>/si', $html, $matches, PREG_SET_ORDER);

    foreach ($matches as $match) {
        $href       = trim($match[1]);
        $anchorText = trim(strip_tags($match[2]));

        // Skip empty, anchor-only, mailto, tel links
        if (empty($href) || str_starts_with($href, '#') || str_starts_with($href, 'mailto:') || str_starts_with($href, 'tel:')) {
            continue;
        }

        // Build absolute URL
        $isRelative  = str_starts_with($href, '/');
        $absoluteUrl = $isRelative ? $siteUrl . $href : $href;

        // A relative href is always internal; an absolute href is internal
        // only if its host matches the site's host (ignoring "www.")
        if ($isRelative) {
            $isInternal = true;
        } else {
            $linkHost   = preg_replace('/^www\./i', '', (string) parse_url($absoluteUrl, PHP_URL_HOST));
            $isInternal = $siteHost !== '' && $linkHost !== '' && strcasecmp($linkHost, $siteHost) === 0;
        }

        $links[] = [
            'anchor_text' => $anchorText ?: '(no text)',
            'url'         => $absoluteUrl,
            'original'    => $href,
            'is_internal' => $isInternal,
        ];
    }

    return $links;
}

// ─── ACTION: GET ALL INTERNAL LINKS ───────────────────────────────────────────
if ($action === 'get_links') {
    $page    = max(1, intval($_GET['page'] ?? 1));
    $perPage = max(1, intval($_GET['perPage'] ?? 50));
    $offset  = ($page - 1) * $perPage;

    // Which post types to scan — untrusted input, so only what's actually
    // published and non-system gets through. Falls back to 'post' (the
    // original behaviour) if nothing requested survives the whitelist.
    $allowedTypes   = array_column(selectable_post_types($conn), 'post_type');
    $requestedTypes = isset($_GET['types']) && $_GET['types'] !== ''
        ? array_filter(array_map('trim', explode(',', $_GET['types'])))
        : ['post'];
    $postTypes = array_values(array_intersect($requestedTypes, $allowedTypes));
    if (!$postTypes) {
        $postTypes = in_array('post', $allowedTypes, true) ? ['post'] : array_slice($allowedTypes, 0, 1);
    }
    $typeList = implode(',', array_map(fn($t) => "'" . $conn->real_escape_string($t) . "'", $postTypes));

    // Get site base URL from WordPress options
    $siteUrlRow = $conn->query("SELECT option_value FROM wp_options WHERE option_name = 'siteurl' LIMIT 1");
    $siteUrl    = '';
    if ($siteUrlRow && $row = $siteUrlRow->fetch_assoc()) {
        $siteUrl = rtrim($row['option_value'], '/');
    }

    // Count total published posts across the selected type(s)
    $countResult = $conn->query("SELECT COUNT(ID) AS total FROM wp_posts WHERE post_type IN ({$typeList}) AND post_status = 'publish'");
    $totalPosts  = 0;
    if ($countResult) {
        $totalPosts = intval($countResult->fetch_assoc()['total'] ?? 0);
    }

    // Fetch posts with pagination
    $sql    = "SELECT ID, post_title, post_type, guid, post_content
               FROM wp_posts
               WHERE post_type IN ({$typeList}) AND post_status = 'publish'
               ORDER BY ID ASC
               LIMIT {$perPage} OFFSET {$offset}";
    $result = $conn->query($sql);

    if (!$result) {
        http_response_code(500);
        echo json_encode(['status' => 'error', 'message' => $conn->error]);
        exit;
    }

    $rows = [];
    while ($row = $result->fetch_assoc()) {
        $rows[] = $row;
    }

    // FAQ Q&A blocks are ACF repeater fields stored in wp_postmeta (e.g.
    // "blog_faqs_0_answer", "faqs_2_answer") — not in post_content — so any
    // <a> inside an FAQ answer is invisible to a post_content-only scan.
    // Pull them in as their own link source, grouped per post_id.
    $faqMetaByPost = [];
    if ($rows) {
        $postIds = array_map(fn($r) => (int) $r['ID'], $rows);
        $idList  = implode(',', $postIds);
        $metaResult = $conn->query(
            "SELECT post_id, meta_key, meta_value FROM wp_postmeta
             WHERE post_id IN ({$idList})
               AND meta_key NOT LIKE '\\_%'
               AND meta_key REGEXP '_[0-9]+_answer$'"
        );
        if ($metaResult) {
            while ($m = $metaResult->fetch_assoc()) {
                $faqMetaByPost[$m['post_id']][] = $m;
            }
        }
    }

    $allLinks = [];
    $siteHost = $siteUrl ? preg_replace('/^www\./i', '', (string) parse_url($siteUrl, PHP_URL_HOST)) : '';

    foreach ($rows as $row) {
        $postId    = $row['ID'];
        $postTitle = $row['post_title'];
        $postType  = $row['post_type'];

        foreach (extract_links_from_html($row['post_content'], $siteUrl, $siteHost) as $link) {
            $allLinks[] = array_merge($link, [
                'post_id'    => $postId,
                'post_title' => $postTitle,
                'post_type'  => $postType,
                'source'     => 'content',
                'meta_key'   => null,
            ]);
        }

        foreach ($faqMetaByPost[$postId] ?? [] as $meta) {
            foreach (extract_links_from_html($meta['meta_value'], $siteUrl, $siteHost) as $link) {
                $allLinks[] = array_merge($link, [
                    'post_id'    => $postId,
                    'post_title' => $postTitle,
                    'post_type'  => $postType,
                    'source'     => 'faq',
                    'meta_key'   => $meta['meta_key'],
                ]);
            }
        }
    }

    // Every occurrence is kept — a URL linked more than once in the same
    // post/field used to be silently collapsed into a single row here, which
    // hid the other <a> tags from the checker entirely. Instead, tag each
    // link with how many times its exact URL repeats within the same source
    // (content, or the same FAQ meta field), so the UI can show it (editing/
    // removing still affects all of them at once, since that's how the href
    // replace in update_link/remove_link works).
    $occurrenceCounts = [];
    foreach ($allLinks as $link) {
        $key = $link['post_id'] . '||' . $link['url'] . '||' . $link['source'] . '||' . $link['meta_key'];
        $occurrenceCounts[$key] = ($occurrenceCounts[$key] ?? 0) + 1;
    }
    foreach ($allLinks as &$link) {
        $key = $link['post_id'] . '||' . $link['url'] . '||' . $link['source'] . '||' . $link['meta_key'];
        $link['occurrence_count'] = $occurrenceCounts[$key];
    }
    unset($link);

    echo json_encode([
        'status'      => 'success',
        'site_url'    => $siteUrl,
        'post_types'  => $postTypes,
        'total_posts' => $totalPosts,
        'page'        => $page,
        'per_page'    => $perPage,
        'total_pages' => (int) ceil($totalPosts / $perPage),
        'link_count'  => count($allLinks),
        'links'       => $allLinks,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

// A link lives either in a post's post_content, or in one specific FAQ
// answer field in postmeta (identified by post_id + meta_key). These two
// helpers read/write whichever one a link actually came from.
function fetch_link_source($conn, $postId, $source, $metaKey)
{
    if ($source === 'faq') {
        if (!$metaKey) return null;
        $stmt = $conn->prepare("SELECT meta_value FROM wp_postmeta WHERE post_id = ? AND meta_key = ? LIMIT 1");
        $stmt->bind_param('is', $postId, $metaKey);
        $stmt->execute();
        $res = $stmt->get_result();
        $row = ($res && $res->num_rows) ? $res->fetch_assoc() : null;
        $stmt->close();
        return $row ? $row['meta_value'] : null;
    }

    $stmt = $conn->prepare("SELECT post_content FROM wp_posts WHERE ID = ?");
    $stmt->bind_param('i', $postId);
    $stmt->execute();
    $res = $stmt->get_result();
    $row = ($res && $res->num_rows) ? $res->fetch_assoc() : null;
    $stmt->close();
    return $row ? $row['post_content'] : null;
}

function save_link_source($conn, $postId, $source, $metaKey, $newContent)
{
    if ($source === 'faq') {
        $stmt = $conn->prepare("UPDATE wp_postmeta SET meta_value = ? WHERE post_id = ? AND meta_key = ?");
        $stmt->bind_param('sis', $newContent, $postId, $metaKey);
        $stmt->execute();
        $affected = $stmt->affected_rows;
        $stmt->close();
        return $affected;
    }

    $stmt = $conn->prepare("UPDATE wp_posts SET post_content = ?, post_modified = NOW(), post_modified_gmt = UTC_TIMESTAMP() WHERE ID = ?");
    $stmt->bind_param('si', $newContent, $postId);
    $stmt->execute();
    $affected = $stmt->affected_rows;
    $stmt->close();
    return $affected;
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
        CURLOPT_FOLLOWLOCATION => false,   // Don't follow - we want the raw 3xx
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
    $source  = ($body['source'] ?? 'content') === 'faq' ? 'faq' : 'content';
    $metaKey = $source === 'faq' ? trim($body['meta_key'] ?? '') : null;

    if (!$postId || !$oldUrl || !$newUrl || ($source === 'faq' && !$metaKey)) {
        echo json_encode(['status' => 'error', 'message' => 'Missing post_id, old_url, new_url, or meta_key']);
        exit;
    }

    $content = fetch_link_source($conn, $postId, $source, $metaKey);
    if ($content === null) {
        echo json_encode(['status' => 'error', 'message' => 'Post or FAQ field not found']);
        exit;
    }

    // Replace old URL with new URL in href attributes
    $newContent = str_replace(
        ['href="' . $oldUrl . '"', "href='" . $oldUrl . "'"],
        ['href="' . $newUrl . '"', "href='" . $newUrl . "'"],
        $content
    );

    if ($newContent === $content) {
        echo json_encode(['status' => 'no_change', 'message' => 'URL not found in ' . ($source === 'faq' ? 'FAQ field' : 'post content')]);
        exit;
    }

    $affected = save_link_source($conn, $postId, $source, $metaKey, $newContent);

    echo json_encode([
        'status'   => 'success',
        'message'  => "Updated {$affected} row(s)",
        'post_id'  => $postId,
        'old_url'  => $oldUrl,
        'new_url'  => $newUrl,
        'source'   => $source,
        'meta_key' => $metaKey,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// ─── ACTION: REMOVE LINK (unlink — strip <a> tag, keep plain text) ────────────
if ($action === 'remove_link' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $body    = json_decode(file_get_contents('php://input'), true);
    $postId  = intval($body['post_id'] ?? 0);
    $url     = trim($body['url'] ?? '');
    $source  = ($body['source'] ?? 'content') === 'faq' ? 'faq' : 'content';
    $metaKey = $source === 'faq' ? trim($body['meta_key'] ?? '') : null;

    if (!$postId || !$url || ($source === 'faq' && !$metaKey)) {
        echo json_encode(['status' => 'error', 'message' => 'Missing post_id, url, or meta_key']);
        exit;
    }

    $content = fetch_link_source($conn, $postId, $source, $metaKey);
    if ($content === null) {
        echo json_encode(['status' => 'error', 'message' => 'Post or FAQ field not found']);
        exit;
    }

    // Match the specific <a href="$url">...</a> tag(s) and replace the whole
    // tag with its plain inner text (any nested markup is stripped too).
    $pattern    = '/<a\s[^>]*href=["\']' . preg_quote($url, '/') . '["\'][^>]*>(.*?)<\/a>/si';
    $count      = 0;
    $newContent = preg_replace_callback($pattern, function ($m) {
        return trim(strip_tags($m[1]));
    }, $content, -1, $count);

    if (!$count) {
        echo json_encode(['status' => 'no_change', 'message' => 'URL not found in ' . ($source === 'faq' ? 'FAQ field' : 'post content')]);
        exit;
    }

    $affected = save_link_source($conn, $postId, $source, $metaKey, $newContent);

    echo json_encode([
        'status'   => 'success',
        'message'  => "Unlinked {$count} occurrence(s) in {$affected} row(s)",
        'post_id'  => $postId,
        'url'      => $url,
        'source'   => $source,
        'meta_key' => $metaKey,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// ─── ACTION: BULK UPDATE LINKS ────────────────────────────────────────────────
if ($action === 'bulk_update' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $body    = json_decode(file_get_contents('php://input'), true);
    $updates = $body['updates'] ?? [];  // [ { post_id, old_url, new_url, source, meta_key }, ... ]

    if (empty($updates)) {
        echo json_encode(['status' => 'error', 'message' => 'No updates provided']);
        exit;
    }

    $results  = [];
    $success  = 0;
    $failed   = 0;

    foreach ($updates as $update) {
        $postId  = intval($update['post_id'] ?? 0);
        $oldUrl  = trim($update['old_url'] ?? '');
        $newUrl  = trim($update['new_url'] ?? '');
        $source  = ($update['source'] ?? 'content') === 'faq' ? 'faq' : 'content';
        $metaKey = $source === 'faq' ? trim($update['meta_key'] ?? '') : null;

        if (!$postId || !$oldUrl || !$newUrl || ($source === 'faq' && !$metaKey)) {
            $results[] = ['post_id' => $postId, 'source' => $source, 'meta_key' => $metaKey, 'status' => 'skipped', 'reason' => 'missing data'];
            $failed++;
            continue;
        }

        $content = fetch_link_source($conn, $postId, $source, $metaKey);
        if ($content === null) {
            $results[] = ['post_id' => $postId, 'source' => $source, 'meta_key' => $metaKey, 'status' => 'error', 'reason' => 'post or field not found'];
            $failed++;
            continue;
        }

        $newContent = str_replace(
            ['href="' . $oldUrl . '"', "href='" . $oldUrl . "'"],
            ['href="' . $newUrl . '"', "href='" . $newUrl . "'"],
            $content
        );

        if ($newContent === $content) {
            $results[] = ['post_id' => $postId, 'old_url' => $oldUrl, 'source' => $source, 'meta_key' => $metaKey, 'status' => 'no_change'];
            continue;
        }

        save_link_source($conn, $postId, $source, $metaKey, $newContent);

        $results[] = ['post_id' => $postId, 'old_url' => $oldUrl, 'new_url' => $newUrl, 'source' => $source, 'meta_key' => $metaKey, 'status' => 'updated'];
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

// ─── ACTION: BULK REMOVE LINKS (unlink — strip <a>, keep plain text) ─────────
if ($action === 'bulk_remove' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $body  = json_decode(file_get_contents('php://input'), true);
    $items = $body['items'] ?? [];  // [ { post_id, url, source, meta_key }, ... ]

    if (empty($items)) {
        echo json_encode(['status' => 'error', 'message' => 'No items provided']);
        exit;
    }

    $results = [];
    $removed = 0;
    $failed  = 0;

    foreach ($items as $item) {
        $postId  = intval($item['post_id'] ?? 0);
        $url     = trim($item['url'] ?? '');
        $source  = ($item['source'] ?? 'content') === 'faq' ? 'faq' : 'content';
        $metaKey = $source === 'faq' ? trim($item['meta_key'] ?? '') : null;

        if (!$postId || !$url || ($source === 'faq' && !$metaKey)) {
            $results[] = ['post_id' => $postId, 'url' => $url, 'source' => $source, 'meta_key' => $metaKey, 'status' => 'skipped', 'reason' => 'missing data'];
            $failed++;
            continue;
        }

        $content = fetch_link_source($conn, $postId, $source, $metaKey);
        if ($content === null) {
            $results[] = ['post_id' => $postId, 'url' => $url, 'source' => $source, 'meta_key' => $metaKey, 'status' => 'error', 'reason' => 'post or field not found'];
            $failed++;
            continue;
        }

        $pattern    = '/<a\s[^>]*href=["\']' . preg_quote($url, '/') . '["\'][^>]*>(.*?)<\/a>/si';
        $count      = 0;
        $newContent = preg_replace_callback($pattern, function ($m) {
            return trim(strip_tags($m[1]));
        }, $content, -1, $count);

        if (!$count) {
            $results[] = ['post_id' => $postId, 'url' => $url, 'source' => $source, 'meta_key' => $metaKey, 'status' => 'no_change'];
            continue;
        }

        save_link_source($conn, $postId, $source, $metaKey, $newContent);

        $results[] = ['post_id' => $postId, 'url' => $url, 'source' => $source, 'meta_key' => $metaKey, 'status' => 'removed'];
        $removed++;
    }

    echo json_encode([
        'status'  => 'success',
        'total'   => count($items),
        'removed' => $removed,
        'failed'  => $failed,
        'results' => $results,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

echo json_encode(['status' => 'error', 'message' => 'Unknown action']);
