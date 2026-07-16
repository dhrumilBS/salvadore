<?php
require_once $_SERVER['DOCUMENT_ROOT'] . '/salvadore/healthray-sql/conn.php';

/**
 * api.php — backend for the Post Revisions manager.
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
    // revisions of each post from deletion — enforced here, not just in the UI.
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
// LIST (default GET action) — grouped by parent post
// =====================================================================
$allowedParentTypes = ['all', 'post', 'page'];
$post_type = $_GET['pt'] ?? 'all';
if (!in_array($post_type, $allowedParentTypes, true)) {
    $post_type = 'all';
}

$searchParentId = (isset($_GET['parent_id']) && ctype_digit($_GET['parent_id'])) ? (int) $_GET['parent_id'] : null;

$page = (isset($_GET['page']) && ctype_digit($_GET['page']) && (int) $_GET['page'] > 0) ? (int) $_GET['page'] : 1;
$perPage = 50 ; // groups (posts) per page, not revisions
$offset = ($page - 1) * $perPage;

$whereClauses = ["p.post_type = 'revision'"];
$params = [];
$types = '';

if ($post_type !== 'all') {
    $whereClauses[] = 'parent.post_type = ?';
    $params[] = $post_type;
    $types .= 's';
}

if ($searchParentId !== null) {
    $whereClauses[] = 'p.post_parent = ?';
    $params[] = $searchParentId;
    $types .= 'i';
}

$whereSql = implode(' AND ', $whereClauses);

// ---- Count total distinct parent posts (groups) for pagination ----
$countSql = "SELECT COUNT(*) AS total FROM (
                SELECT p.post_parent
                FROM wp_posts p
                LEFT JOIN wp_posts parent ON parent.ID = p.post_parent
                WHERE $whereSql
                GROUP BY p.post_parent
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
        parent.post_name   AS post_name,
        parent.post_type   AS post_type,
        parent.post_status AS post_status,
        COUNT(p.ID) AS revision_count,
        MAX(p.post_modified) AS last_revision
    FROM wp_posts p
    LEFT JOIN wp_posts parent ON parent.ID = p.post_parent
    WHERE $whereSql
    GROUP BY p.post_parent
    ORDER BY revision_count DESC
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
        'post_name' => $row['post_name'],
        'post_type' => $row['post_type'],
        'post_status' => $row['post_status'],
        'revision_count' => (int) $row['revision_count'],
        'last_revision' => $row['last_revision'],
        'total_meta' => 0,
        'revisions' => [],
    ];
}
$groupStmt->close();

// ---- Fetch the individual revisions (+ meta counts) for those posts ----
if (!empty($postIds)) {
    $idPlaceholders = implode(',', array_fill(0, count($postIds), '?'));
    $idTypes = str_repeat('i', count($postIds));

    $revSql = "SELECT
            p.ID AS revision_id,
            p.post_parent,
            p.post_title,
            p.post_date,
            p.post_modified,
            p.post_status,
            (SELECT COUNT(*) FROM wp_postmeta pm WHERE pm.post_id = p.ID) AS meta_count
        FROM wp_posts p
        WHERE p.post_type = 'revision' AND p.post_parent IN ($idPlaceholders)
        ORDER BY p.post_parent DESC, p.post_date DESC";

    $revStmt = $conn->prepare($revSql);
    $revStmt->bind_param($idTypes, ...$postIds);
    $revStmt->execute();
    $revResult = $revStmt->get_result();

    while ($row = $revResult->fetch_assoc()) {
        $postId = (int) $row['post_parent'];
        if (!isset($groups[$postId])) continue;

        $metaCount = (int) $row['meta_count'];
        $groups[$postId]['total_meta'] += $metaCount;
        $groups[$postId]['revisions'][] = [
            'revision_id' => (int) $row['revision_id'],
            'post_title' => $row['post_title'],
            'post_date' => $row['post_date'],
            'post_modified' => $row['post_modified'],
            'post_status' => $row['post_status'],
            'meta_count' => $metaCount,
        ];
    }
    $revStmt->close();
}

echo json_encode([
    'success' => true,
    'groups' => array_values($groups),
    'totalGroups' => $totalGroups,
    'page' => $page,
    'perPage' => $perPage,
    'totalPages' => $totalPages,
    'filters' => [
        'pt' => $post_type,
        'parent_id' => $searchParentId,
    ],
]);