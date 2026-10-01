<?php

/**
 * Returns posts of a given type/status with their Yoast focus keyword,
 * categories, dates, the real public URL, and a "duplicate" flag
 * (same focus keyword used more than once).
 *
 * Notes:
 *   - focus keyword pulled via a single LEFT JOIN instead of a correlated subquery
 *   - post_type / post_status bound through a prepared statement
 *   - the public URL is resolved by api/permalink.php (wp_posts.guid is the ugly
 *     "?p=123" form and is useless for an SEO audit)
 *   - server-side query timing returned so the UI can show fetch performance
 */

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["error" => "POST method required"]);
    exit;
}

require __DIR__ . '/../auth.php';
fk_require_api_auth();
require __DIR__ . '/conn.php';
require __DIR__ . '/permalink.php';
header("Content-Type: application/json");

$post_type     = $_POST['post_type']   ?? 'post';
$post_status   = $_POST['post_status'] ?? 'publish';
$onlyDuplicate = intval($_POST['only_duplicate'] ?? 0);

/* "any" (or blank) means every status except WordPress' internal ones. */
$anyStatus = ($post_status === '' || $post_status === 'any');

$statusClause = $anyStatus
    ? "AND p.post_status NOT IN ('auto-draft','inherit')"
    : "AND p.post_status = ?";

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
    GROUP_CONCAT(DISTINCT tt.term_id ORDER BY tt.term_id ASC)          AS category_ids,
    GROUP_CONCAT(DISTINCT t.name ORDER BY t.name SEPARATOR ', ')       AS categories
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
WHERE p.post_type = ?
    $statusClause
GROUP BY p.ID
ORDER BY focus_keyword DESC, p.post_modified DESC";

$t0 = microtime(true);

$stmt = $conn->prepare($sql);
if (!$stmt) {
    http_response_code(500);
    echo json_encode(["status" => "error", "error" => $conn->error]);
    exit;
}
if ($anyStatus) {
    $stmt->bind_param("s", $post_type);
} else {
    $stmt->bind_param("ss", $post_type, $post_status);
}
$stmt->execute();
$result = $stmt->get_result();

$rows         = [];
$keywordCount = [];

while ($row = $result->fetch_assoc()) {
    $fk = trim(strtolower($row['focus_keyword'] ?? ""));
    if ($fk !== "") {
        $keywordCount[$fk] = ($keywordCount[$fk] ?? 0) + 1;
    }
    $rows[] = $row;
}

// Mark duplicates (same focus keyword used more than once)
foreach ($rows as &$row) {
    $fk = trim(strtolower($row['focus_keyword'] ?? ""));
    $row['duplicate'] = ($fk !== "" && $keywordCount[$fk] > 1);
}
unset($row);

if ($onlyDuplicate === 1) {
    $rows = array_values(array_filter($rows, fn($r) => $r['duplicate'] === true));
}

/* Resolve the real public URL for every row. */
$ctx = fk_site_context($conn);
fk_attach_permalinks($rows, $ctx);

$serverMs = round((microtime(true) - $t0) * 1000, 1);

fk_json_out([
    "database"       => $DB_KEY,
    "status"         => "success",
    "post_type"      => $post_type,
    "post_status"    => $anyStatus ? 'any' : $post_status,
    "site_home"      => $ctx['home'],
    "server_time_ms" => $serverMs,
    "row_count"      => count($rows),
    "data"           => $rows,
    "keywordCount"   => $keywordCount,
]);

$stmt->close();
exit;
