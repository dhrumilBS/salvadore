<?php

/**
 * Lists the post types that are actually worth auditing, with a per-status
 * breakdown, so the UI dropdowns can be built from real data instead of a
 * hard-coded ['post','page'] list.
 */

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["status" => "error", "error" => "POST method required"]);
    exit;
}

require __DIR__ . '/../auth.php';
fk_require_api_auth();
require __DIR__ . '/conn.php';
header("Content-Type: application/json");

/* Internal / plumbing post types that never have a public URL worth auditing. */
$hidden = [
    'revision',
    'attachment',
    'nav_menu_item',
    'custom_css',
    'customize_changeset',
    'oembed_cache',
    'user_request',
    'wp_block',
    'wp_template',
    'wp_template_part',
    'wp_global_styles',
    'wp_navigation',
    'acf-field',
    'acf-field-group',
    'acf-taxonomy',
    'acf-post-type',
    'acf-ui-options-page',
    'elementor_library',
    'e-landing-page',
    'e_global_class',
    'elementor_font',
    'wpcf7_contact_form',
    'wpcf7r_action',
    'cf7_to_any_api',
    'frm_form_actions',
    'frm_styles',
    'wpcode',
    'scheduled-action',
];

$placeholders = implode(',', array_fill(0, count($hidden), '?'));

$sql = "SELECT post_type, post_status, COUNT(*) AS n
        FROM wp_posts
        WHERE post_status NOT IN ('auto-draft','inherit')
          AND post_type NOT IN ($placeholders)
        GROUP BY post_type, post_status";

$stmt = $conn->prepare($sql);
if (!$stmt) {
    http_response_code(500);
    echo json_encode(["status" => "error", "error" => $conn->error]);
    exit;
}
$stmt->bind_param(str_repeat('s', count($hidden)), ...$hidden);
$stmt->execute();
$res = $stmt->get_result();

$types    = [];
$statuses = [];
while ($row = $res->fetch_assoc()) {
    $pt = $row['post_type'];
    $st = $row['post_status'];
    $n  = (int) $row['n'];

    if (!isset($types[$pt])) {
        $types[$pt] = ['name' => $pt, 'total' => 0, 'statuses' => []];
    }
    $types[$pt]['total'] += $n;
    $types[$pt]['statuses'][$st] = ($types[$pt]['statuses'][$st] ?? 0) + $n;
    $statuses[$st] = ($statuses[$st] ?? 0) + $n;
}
$stmt->close();

/* post and page first, then everything else by volume. */
uasort($types, function ($a, $b) {
    $rank = ['post' => 0, 'page' => 1];
    $ra   = $rank[$a['name']] ?? 2;
    $rb   = $rank[$b['name']] ?? 2;
    return $ra === $rb ? $b['total'] <=> $a['total'] : $ra <=> $rb;
});

arsort($statuses);

fk_json_out([
    "database"   => $DB_KEY,
    "status"     => "success",
    "post_types" => array_values($types),
    "statuses"   => $statuses,
]);
exit;
