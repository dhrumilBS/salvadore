<?php
/*
 * Which site to work on comes ONLY from this request's "db" param. Never the
 * shared "db" cookie that other tools (e.g. wp_options) set for the whole
 * domain - otherwise this page could list and delete another site's revisions
 * while showing the wrong site name.
 */
$VERSION_SITES = ['landing' => 'Healthray', 'botphonic' => 'Botphonic'];
$requestedDb = $_GET['db'] ?? $_POST['db'] ?? 'landing';
$ACTIVE_DB = isset($VERSION_SITES[$requestedDb]) ? $requestedDb : 'landing';
require_once __DIR__ . '/../conn.php';

/**
 * api.php - backend for the Post Revisions manager.
 *
 * GET  ?action=list        -> returns revisions grouped by parent post, as JSON
 * POST  action=delete_revisions, ids[]=...  -> deletes revisions + their postmeta
 *
 * NOTE: This endpoint has no authentication check of its own. Make sure it
 * sits behind your admin login / IP allowlist before exposing it anywhere.
 */

header('Content-Type: application/json');

// =====================================================================
// DELETE
// =====================================================================
if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'delete_revisions') {
    $ids = $_POST['ids'] ?? [];
    $ids = array_values(array_unique(array_filter(array_map('intval', (array) $ids), fn($v) => $v > 0)));

    if (empty($ids)) {
        echo json_encode(['success' => false, 'message' => 'No valid revision IDs were provided.']);
        exit;
    }

    // Re-verify server-side that every ID is really a revision row before touching anything.
    // We also need each row's post_parent so we can protect the 5 most recent
    // revisions of each post from deletion - enforced here, not just in the UI.
    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $types = str_repeat('i', count($ids));

    $checkStmt = $conn->prepare("SELECT ID, post_parent FROM wp_posts WHERE ID IN ($placeholders) AND post_type = 'revision'");
    $checkStmt->bind_param($types, ...$ids);
    $checkStmt->execute();
    $checkResult = $checkStmt->get_result();

    $validRows = []; // id => post_parent
    while ($row = $checkResult->fetch_assoc()) {
        $validRows[(int) $row['ID']] = (int) $row['post_parent'];
    }
    $checkStmt->close();

    if (empty($validRows)) {
        echo json_encode(['success' => false, 'message' => 'None of the selected IDs are valid revisions. Nothing was deleted.']);
        exit;
    }

    // ---- Work out which revisions are "protected" (the 5 most recent for their post) ----
    $parentIds = array_values(array_unique($validRows));
    $protectedIds = [];

    foreach ($parentIds as $pid) {
        $recentStmt = $conn->prepare(
            "SELECT ID FROM wp_posts WHERE post_parent = ? AND post_type = 'revision' ORDER BY post_date DESC LIMIT 5"
        );
        $recentStmt->bind_param('i', $pid);
        $recentStmt->execute();
        $recentResult = $recentStmt->get_result();
        while ($r = $recentResult->fetch_assoc()) {
            $protectedIds[(int) $r['ID']] = true;
        }
        $recentStmt->close();
    }

    $deletableIds = [];
    $protectedSkipped = 0;
    foreach ($validRows as $id => $parent) {
        if (isset($protectedIds[$id])) {
            $protectedSkipped++;
            continue;
        }
        $deletableIds[] = $id;
    }

    if (empty($deletableIds)) {
        echo json_encode([
            'success' => false,
            'message' => 'All selected revisions are among the 5 most recent for their post and are protected from deletion.',
        ]);
        exit;
    }

    $delPlaceholders = implode(',', array_fill(0, count($deletableIds), '?'));
    $delTypes = str_repeat('i', count($deletableIds));

    $conn->begin_transaction();
    try {
        $metaStmt = $conn->prepare("DELETE FROM wp_postmeta WHERE post_id IN ($delPlaceholders)");
        $metaStmt->bind_param($delTypes, ...$deletableIds);
        $metaStmt->execute();
        $metaDeleted = $metaStmt->affected_rows;
        $metaStmt->close();

        $postStmt = $conn->prepare("DELETE FROM wp_posts WHERE ID IN ($delPlaceholders) AND post_type = 'revision'");
        $postStmt->bind_param($delTypes, ...$deletableIds);
        $postStmt->execute();
        $postsDeleted = $postStmt->affected_rows;
        $postStmt->close();

        $conn->commit();

        echo json_encode([
            'success' => true,
            'db' => $ACTIVE_DB,
            'deleted_posts' => $postsDeleted,
            'deleted_meta' => $metaDeleted,
            'deleted_ids' => $deletableIds,
            'skipped' => count($ids) - count($validRows),
            'protected_skipped' => $protectedSkipped,
        ]);
    } catch (\Throwable $e) {
        $conn->rollback();
        echo json_encode(['success' => false, 'message' => 'Delete failed: ' . $e->getMessage()]);
    }
    exit;
}

// =====================================================================
// META - site overview: totals, post types / statuses, admin URL
// =====================================================================
if (($_GET['action'] ?? '') === 'meta') {
    $totals = $conn->query(
        "SELECT COUNT(*) AS revisions, COUNT(DISTINCT post_parent) AS posts, COALESCE(SUM(LENGTH(post_content)), 0) AS bytes
         FROM wp_posts WHERE post_type = 'revision'"
    )->fetch_assoc();

    // Revisions beyond the 5 newest per post - what can actually be deleted
    $deletable = (int) ($conn->query(
        "SELECT COALESCE(SUM(GREATEST(c - 5, 0)), 0) FROM (
            SELECT COUNT(*) AS c FROM wp_posts WHERE post_type = 'revision' GROUP BY post_parent
         ) t"
    )->fetch_row()[0] ?? 0);

    $metaRows = (int) ($conn->query(
        "SELECT COUNT(*) FROM wp_postmeta pm JOIN wp_posts p ON p.ID = pm.post_id WHERE p.post_type = 'revision'"
    )->fetch_row()[0] ?? 0);

    // Parent post types / statuses that actually have revisions on THIS site
    $breakdown = function ($col) use ($conn) {
        $out = [];
        $res = $conn->query(
            "SELECT COALESCE(parent.$col, '(missing)') AS k, COUNT(DISTINCT p.post_parent) AS posts, COUNT(*) AS revisions
             FROM wp_posts p LEFT JOIN wp_posts parent ON parent.ID = p.post_parent
             WHERE p.post_type = 'revision'
             GROUP BY k ORDER BY revisions DESC"
        );
        while ($r = $res->fetch_assoc()) {
            $out[] = ['key' => $r['k'], 'posts' => (int) $r['posts'], 'revisions' => (int) $r['revisions']];
        }
        return $out;
    };

    $opts = [];
    $res = $conn->query("SELECT option_name, option_value FROM wp_options WHERE option_name IN ('siteurl', 'home')");
    while ($r = $res->fetch_assoc()) {
        $opts[$r['option_name']] = rtrim($r['option_value'], '/');
    }
    $siteUrl = $opts['siteurl'] ?? $opts['home'] ?? '';

    echo json_encode([
        'success' => true,
        'db' => $ACTIVE_DB,
        'label' => $VERSION_SITES[$ACTIVE_DB],
        'admin_url' => $siteUrl !== '' ? $siteUrl . '/wp-admin/' : '',
        'home_url' => $opts['home'] ?? $siteUrl,
        'keep' => 5,
        'totals' => [
            'posts' => (int) $totals['posts'],
            'revisions' => (int) $totals['revisions'],
            'bytes' => (int) $totals['bytes'],
            'deletable' => $deletable,
            'meta_rows' => $metaRows,
        ],
        'types' => $breakdown('post_type'),
        'statuses' => $breakdown('post_status'),
    ]);
    exit;
}

// =====================================================================
// LIST (default GET action) - grouped by parent post
// =====================================================================
$whereClauses = ["p.post_type = 'revision'"];
$params = [];
$types = '';

// Parent post type / status - any value is safe, it's only ever a bound parameter
$post_type = trim($_GET['pt'] ?? 'all');
if ($post_type !== '' && $post_type !== 'all') {
    $whereClauses[] = 'parent.post_type = ?';
    $params[] = $post_type;
    $types .= 's';
}
$status = trim($_GET['status'] ?? 'all');
if ($status !== '' && $status !== 'all') {
    $whereClauses[] = 'parent.post_status = ?';
    $params[] = $status;
    $types .= 's';
}

// Search: a number matches the post ID or one of its revision IDs; text matches title / slug
$q = trim($_GET['q'] ?? ($_GET['parent_id'] ?? ''));
if ($q !== '') {
    if (ctype_digit($q)) {
        $whereClauses[] = "(p.post_parent = ? OR p.post_parent = (SELECT r.post_parent FROM wp_posts r WHERE r.ID = ? AND r.post_type = 'revision'))";
        $params[] = (int) $q;
        $params[] = (int) $q;
        $types .= 'ii';
    } else {
        $whereClauses[] = '(parent.post_title LIKE ? OR parent.post_name LIKE ?)';
        $like = '%' . $q . '%';
        $params[] = $like;
        $params[] = $like;
        $types .= 'ss';
    }
}

$whereSql = implode(' AND ', $whereClauses);
$havingSql = !empty($_GET['only_old']) ? 'HAVING COUNT(p.ID) > 5' : '';

$sorts = [
    'revs'   => 'revision_count DESC, last_revision DESC',
    'meta'   => 'total_meta DESC, revision_count DESC',
    'size'   => 'total_bytes DESC',
    'recent' => 'last_revision DESC',
    'oldest' => 'last_revision ASC',
    'title'  => 'post_title ASC',
];
$sort = isset($sorts[$_GET['sort'] ?? '']) ? $_GET['sort'] : 'revs';

$page = (isset($_GET['page']) && ctype_digit($_GET['page']) && (int) $_GET['page'] > 0) ? (int) $_GET['page'] : 1;
$perPage = (int) ($_GET['per_page'] ?? 25); // groups (posts) per page, not revisions
if (!in_array($perPage, [25, 50, 100], true)) $perPage = 25;
$offset = ($page - 1) * $perPage;

// ---- Count total distinct parent posts (groups) for pagination ----
$countSql = "SELECT COUNT(*) AS total FROM (
                SELECT p.post_parent
                FROM wp_posts p
                LEFT JOIN wp_posts parent ON parent.ID = p.post_parent
                WHERE $whereSql
                GROUP BY p.post_parent
                $havingSql
             ) t";
$countStmt = $conn->prepare($countSql);
if ($types !== '') {
    $countStmt->bind_param($types, ...$params);
}
$countStmt->execute();
$totalGroups = (int) ($countStmt->get_result()->fetch_assoc()['total'] ?? 0);
$countStmt->close();
$totalPages = max(1, (int) ceil($totalGroups / $perPage));

// ---- Fetch the page of parent-post groups, with aggregate counts ----
$groupSql = "SELECT
        p.post_parent AS post_id,
        MAX(parent.post_title)  AS post_title,
        MAX(parent.post_name)   AS post_name,
        MAX(parent.post_type)   AS post_type,
        MAX(parent.post_status) AS post_status,
        COUNT(p.ID) AS revision_count,
        MAX(p.post_modified) AS last_revision,
        SUM(LENGTH(p.post_content)) AS total_bytes,
        SUM((SELECT COUNT(*) FROM wp_postmeta pm WHERE pm.post_id = p.ID)) AS total_meta
    FROM wp_posts p
    LEFT JOIN wp_posts parent ON parent.ID = p.post_parent
    WHERE $whereSql
    GROUP BY p.post_parent
    $havingSql
    ORDER BY {$sorts[$sort]}
    LIMIT ? OFFSET ?";

$groupParams = $params;
$groupTypes = $types . 'ii';
$groupParams[] = $perPage;
$groupParams[] = $offset;

$groupStmt = $conn->prepare($groupSql);
$groupStmt->bind_param($groupTypes, ...$groupParams);
$groupStmt->execute();
$groupResult = $groupStmt->get_result();

$groups = [];
$postIds = [];
while ($row = $groupResult->fetch_assoc()) {
    $postId = (int) $row['post_id'];
    $postIds[] = $postId;
    $groups[$postId] = [
        'post_id' => $postId,
        'post_title' => $row['post_title'],
        'post_name' => $row['post_name'],
        'post_type' => $row['post_type'],
        'post_status' => $row['post_status'],
        'revision_count' => (int) $row['revision_count'],
        'last_revision' => $row['last_revision'],
        'total_bytes' => (int) $row['total_bytes'],
        'total_meta' => (int) $row['total_meta'],
        'revisions' => [],
    ];
}
$groupStmt->close();

// ---- Fetch the individual revisions (+ meta count, author, size) for those posts ----
// Same newest-first order the delete endpoint uses to protect the latest 5.
if (!empty($postIds)) {
    $idPlaceholders = implode(',', array_fill(0, count($postIds), '?'));
    $idTypes = str_repeat('i', count($postIds));

    $revSql = "SELECT
            p.ID AS revision_id,
            p.post_parent,
            p.post_title,
            p.post_name,
            p.post_date,
            p.post_modified,
            p.post_status,
            LENGTH(p.post_content) AS bytes,
            u.display_name AS author,
            (SELECT COUNT(*) FROM wp_postmeta pm WHERE pm.post_id = p.ID) AS meta_count
        FROM wp_posts p
        LEFT JOIN wp_users u ON u.ID = p.post_author
        WHERE p.post_type = 'revision' AND p.post_parent IN ($idPlaceholders)
        ORDER BY p.post_parent DESC, p.post_date DESC";

    $revStmt = $conn->prepare($revSql);
    $revStmt->bind_param($idTypes, ...$postIds);
    $revStmt->execute();
    $revResult = $revStmt->get_result();

    while ($row = $revResult->fetch_assoc()) {
        $postId = (int) $row['post_parent'];
        if (!isset($groups[$postId])) continue;

        $groups[$postId]['revisions'][] = [
            'revision_id' => (int) $row['revision_id'],
            'post_title' => $row['post_title'],
            'autosave' => strpos((string) $row['post_name'], 'autosave') !== false,
            'post_date' => $row['post_date'],
            'post_modified' => $row['post_modified'],
            'post_status' => $row['post_status'],
            'bytes' => (int) $row['bytes'],
            'author' => $row['author'],
            'meta_count' => (int) $row['meta_count'],
        ];
    }
    $revStmt->close();
}

echo json_encode([
    'success' => true,
    'db' => $ACTIVE_DB,
    'groups' => array_values($groups),
    'totalGroups' => $totalGroups,
    'page' => $page,
    'perPage' => $perPage,
    'totalPages' => $totalPages,
]);
