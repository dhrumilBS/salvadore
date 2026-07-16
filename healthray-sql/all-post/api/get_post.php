<?php
require $_SERVER['DOCUMENT_ROOT'] . '/salvadore/healthray-sql/conn.php';

$query = "SELECT id, post_name, post_title, menu_order, post_status, post_date
FROM wp_posts
WHERE post_type = 'page' AND post_status = 'publish' OR post_status = 'trash'
ORDER BY menu_order ASC;";

$res = $conn->query($query);

$state = [];
if ($res && mysqli_num_rows($res) > 0) {

    while ($row = $res->fetch_assoc()) {
        $card = [
            'id' => $row['id'],
            'post_name' => $row['post_name'],
            'post_title' => $row['post_title'],
            'post_status' => $row['post_status'],
            'menu_order' => $row['menu_order'],
            'post_date' => $row['post_date'],
        ];
        $state[] = $card;
    }
    $result = ['success' => true, "msg" => "List Successful", "data" => $state];
} else {
    $result = ['success' => false, "msg" => "No data found"];
}
echo json_encode($result);