<?php

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["error" => "POST method required"]);
    exit;
}

require __DIR__ . '/../auth.php';
fk_require_api_auth();
require __DIR__ . '/conn.php';
header("Content-Type: application/json");


$categories = [];

$sqlCat = "SELECT t.term_id, t.name, t.slug, tt.count
    FROM wp_terms t
    INNER JOIN wp_term_taxonomy tt
        ON t.term_id = tt.term_id
    WHERE tt.taxonomy = 'category'
    ORDER BY tt.count DESC
";

$resultCat = $conn->query($sqlCat);

while ($row = $resultCat->fetch_assoc()) {
    $categories[] = $row;
}

echo json_encode([
    "database"       => $DB_KEY,
    "status"         => "success",
    "categories"     => $categories,
]);
exit;
