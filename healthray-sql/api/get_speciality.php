<?php
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); // Method Not Allowed
    return json_encode(["Invalid request method"]);
}

require $_SERVER['DOCUMENT_ROOT'] . '/salvadore/healthray-sql/conn.php';
$query = "SELECT p.id, p.post_name, p.post_title, p.menu_order, p.post_date, pm.meta_key, pm.meta_value, p.post_status
    FROM wp_posts p LEFT JOIN wp_postmeta pm ON p.id = pm.post_id
    WHERE p.post_type = 'page' AND (pm.meta_value ='templates/template-speciality.php')  AND p.post_type='page'
    ORDER BY p.post_status DESC;";

$res = $conn->query($query);

$state = [];
if ($res && mysqli_num_rows($res) > 0) {
    while ($row = $res->fetch_assoc()) {
        $card = [
            'id' => $row['id'],
            'post_name' => $row['post_name'],
            'post_title' => $row['post_title'],
            'menu_order' => $row['menu_order'],
            'post_date' => $row['post_date'],
            'post_status' => $row['post_status'],
            'meta_key' => $row['meta_key'],
            'meta_value' => $row['meta_value'],
        ];
        $state[] = $card;
    }
    $result = ['success' => true, "msg" => "List Successful", "data" => $state];
} else {
    $result = ['success' => false, "msg" => "No data found"];
}


echo json_encode($result);
