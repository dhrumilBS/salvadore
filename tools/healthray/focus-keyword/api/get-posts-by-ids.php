<?php

/**
 * Returns posts for an explicit list of IDs — regardless of post_status
 * (publish, draft, trash, pending, private, …) — together with their Yoast
 * focus keyword, categories, dates and public URL. Used by the "Post ID
 * Lookup" panel.
 */

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["status" => "error", "error" => "POST method required"]);
    exit;
}

require __DIR__ . '/../auth.php';
fk_require_api_auth();
require __DIR__ . '/conn.php';
require __DIR__ . '/permalink.php';
header("Content-Type: application/json");

// Accept IDs as comma / whitespace / newline separated text.
$idsRaw = $_POST['ids'] ?? '';
$ids = array_values(array_unique(array_filter(
    array_map('intval', preg_split('/[\s,]+/', trim($idsRaw))),
    fn($v) => $v > 0
)));

if (empty($ids)) {
    echo json_encode(["status" => "error", "error" => "No valid post IDs provided"]);
    exit;
}

$placeholders = implode(',', array_fill(0, count($ids), '?'));
$types        = str_repeat('i', count($ids));

$sql = "SELECT
    p.ID,
    p.post_name,
    p.post_title,
    p.post_type,
    p.guid,
    p.post_status,
    p.post_date,
    p.post_modified,
    p.post_parent,
    p.post_author,
    MAX(pm.meta_value)  AS focus_keyword,
    MAX(pmc.meta_value) AS primary_category,
    MAX(yi.permalink)   AS yoast_permalink,
    GROUP_CONCAT(DISTINCT tt.term_id ORDER BY tt.term_id ASC)    AS category_ids,
    GROUP_CONCAT(DISTINCT t.name ORDER BY t.name SEPARATOR ', ') AS categories
FROM wp_posts p
LEFT JOIN wp_postmeta pm
    ON pm.post_id = p.ID
    AND pm.meta_key = '_yoast_wpseo_focuskw'
LEFT JOIN wp_postmeta pmc
    ON pmc.post_id = p.ID
    AND pmc.meta_key = '_yoast_wpseo_primary_category'
LEFT JOIN wp_yoast_indexable yi
    ON yi.object_id = p.ID
    AND yi.object_type = 'post'
LEFT JOIN wp_term_relationships tr
    ON p.ID = tr.object_id
LEFT JOIN wp_term_taxonomy tt
    ON tr.term_taxonomy_id = tt.term_taxonomy_id
    AND tt.taxonomy = 'category'
LEFT JOIN wp_terms t
    ON tt.term_id = t.term_id
WHERE p.ID IN ($placeholders)
GROUP BY p.ID
ORDER BY FIELD(p.ID, $placeholders)";

$t0 = microtime(true);

$stmt = $conn->prepare($sql);
if (!$stmt) {
    http_response_code(500);
    echo json_encode(["status" => "error", "error" => $conn->error]);
    exit;
}

// IDs are bound twice: once for the IN(...) filter, once for ORDER BY FIELD(...).
$stmt->bind_param($types . $types, ...$ids, ...$ids);
$stmt->execute();
$result = $stmt->get_result();

$rows  = [];
$found = [];
while ($row = $result->fetch_assoc()) {
    $rows[]  = $row;
    $found[] = (int) $row['ID'];
}

/* Resolve the real public URL for every row. */
$ctx = fk_site_context($conn);
fk_attach_permalinks($rows, $ctx);

$missing = array_values(array_diff($ids, $found));

$serverMs = round((microtime(true) - $t0) * 1000, 1);

fk_json_out([
    "database"       => $DB_KEY,
    "status"         => "success",
    "requested"      => $ids,
    "missing"        => $missing,
    "site_home"      => $ctx['home'],
    "server_time_ms" => $serverMs,
    "row_count"      => count($rows),
    "data"           => $rows,
]);

$stmt->close();
exit;
