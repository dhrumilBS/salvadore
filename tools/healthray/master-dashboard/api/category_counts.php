<?php
/**
 * GET api/category_counts.php?status=publish - the Content tab's Category
 * dropdown (shown on the Post tab only): every post category with how many
 * posts of that status are filed directly under it, the same match the
 * `category` filter in dw_build_where() uses. `total` = posts of that status,
 * for the "All categories" option.
 */
require __DIR__ . '/bootstrap.php';

$status = trim((string) ($_GET['status'] ?? 'publish'));
if (!array_key_exists($status, dw_post_statuses())) {
    $status = 'publish';
}
$statusSql = $status === 'any' ? '1=1' : 'p.post_status = ?';
$params    = $status === 'any' ? [] : [['type' => 's', 'value' => $status]];

$stmt = $conn->prepare("SELECT t.term_id AS id, t.name, tt.parent, COUNT(DISTINCT p.ID) AS count
    FROM wp_term_taxonomy tt
    INNER JOIN wp_terms t ON t.term_id = tt.term_id
    LEFT JOIN wp_term_relationships tr ON tr.term_taxonomy_id = tt.term_taxonomy_id
    LEFT JOIN wp_posts p ON p.ID = tr.object_id AND p.post_type = 'post' AND $statusSql
    WHERE tt.taxonomy = 'category'
    GROUP BY t.term_id, t.name, tt.parent
    ORDER BY t.name ASC");
dw_stmt_bind($stmt, $params);
$stmt->execute();
$categories = array_map(fn($r) => [
    'id'     => (int) $r['id'],
    'name'   => $r['name'],
    'parent' => (int) $r['parent'],
    'count'  => (int) $r['count'],
], $stmt->get_result()->fetch_all(MYSQLI_ASSOC));

$stmt = $conn->prepare("SELECT COUNT(*) FROM wp_posts p WHERE p.post_type = 'post' AND $statusSql");
dw_stmt_bind($stmt, $params);
$stmt->execute();
$total = (int) $stmt->get_result()->fetch_row()[0];

json_out(true, 'Categories loaded', ['categories' => $categories, 'total' => $total, 'status' => $status]);
