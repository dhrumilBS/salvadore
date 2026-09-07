<?php
require $_SERVER['DOCUMENT_ROOT'] . '/salvadore/healthray-sql/conn.php';

$allowedCategories = ['%state-city%', '%lab%', '%emr%', '%ehr%', '%pms%'];
$t = $_POST['category'] ?? '';

header('Content-Type: application/json; charset=utf-8');
if (!in_array($t, $allowedCategories, true)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'msg' => 'Please select a valid category.', 'data' => []]);
    exit;
}

$allTemplateState = [];
$state = [];
$query = "SELECT
p.id AS main_id, p.post_name AS main_post_name, p.post_title AS main_post_title, p.post_status AS main_post_status, p.menu_order AS main_menu_order,
sub_p.id AS sub_id, sub_p.post_name AS sub_post_name, sub_p.post_title AS sub_post_title, sub_p.post_status AS sub_post_status, sub_p.menu_order AS sub_menu_order
FROM
wp_posts p
INNER JOIN
wp_postmeta pm ON p.id = pm.post_id
LEFT JOIN
wp_postmeta sub_pm ON sub_pm.meta_value = p.id
LEFT JOIN
wp_posts sub_p ON sub_pm.post_id = sub_p.id AND sub_p.post_type = 'page'
WHERE
p.post_type = 'page' AND pm.meta_value LIKE '$t'

ORDER BY
p.post_title ASC, sub_p.post_title ASC;
";

$res = $conn->query($query);
if ($res && mysqli_num_rows($res) > 0) {
    $temp_array = [];
    $last_main_id = null;

    while ($row = $res->fetch_assoc()) {
        $main_id = $row['main_id'];

        if ($main_id !== $last_main_id && $last_main_id !== null) {
            $state[count($state) - 1]["textdata"] = $temp_array;
            $temp_array = [];
        }
        if ($main_id !== $last_main_id) {
            // Start a new card entry
            $card = [
                'id' => $row['main_id'],
                'post_name' => $row['main_post_name'],
                'post_title' => $row['main_post_title'],
                'post_status' => $row['main_post_status'],
                'menu_order' => $row['main_menu_order'],
            ];
            $state[] = $card;
            $last_main_id = $main_id;
        }

        if ($row['sub_id'] !== null) {
            // Add sub-post details
            $temp_array[] = [
                'id' => $row['sub_id'],
                'post_name' => $row['sub_post_name'],
                'post_status' => $row['sub_post_status'],
                'post_title' => $row['sub_post_title'],
                'menu_order' => $row['sub_menu_order'],
            ];
        }
    }
    if (!empty($temp_array)) {
        $state[count($state) - 1]["textdata"] = $temp_array;
    }
}

$result = [
    'success' => true,
    "msg" => "List Successful",
    "post" => $_POST,
    "data" => $state,
    $t
];

echo json_encode($result);
