<?php
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); // Method Not Allowed
    return json_encode(["Invalid request method"]);
}

require $_SERVER['DOCUMENT_ROOT'] . '/salvadore/botphonic-sql/conn.php';
header("Content-Type: application/json");
$payload = $_POST;
$post_type = $_POST['post_type'] ?? $_POST['post_type'] ?? 'post';
$onlyDuplicate = intval($_POST['only_duplicate'] ?? $_GET['only_duplicate'] ?? 0);

$sql = "SELECT p.ID, p.post_name, p.post_title, p.guid, p.post_date,
        (SELECT meta_value FROM wp_postmeta 
         WHERE post_id = p.ID AND meta_key = '_yoast_wpseo_focuskw'
         LIMIT 1) AS focus_keyword,
        (SELECT pm.meta_value
            FROM wp_postmeta pm
            WHERE pm.post_id = p.ID
              AND pm.meta_key = '_yoast_wpseo_canonical'
            LIMIT 1
) AS canonical_url
    FROM wp_posts p
    WHERE p.post_type='$post_type' AND p.post_status='publish'
    ORDER BY focus_keyword DESC";

$result = $conn->query($sql);

// Build rows
$rows = [];
$keywordCount = [];
$remarksFile = __DIR__ . "/remarks.json";
$remarks = file_exists($remarksFile) ? json_decode(file_get_contents($remarksFile), true) : [];

while ($row = $result->fetch_assoc()) {
    $fk = trim(strtolower($row['focus_keyword'] ?? ""));
    if ($fk !== "") {
        if (!isset($keywordCount[$fk])) {
            $keywordCount[$fk] = 0;
        }
        $keywordCount[$fk]++;
    }

    $row["remark"] = $remarks[$row["ID"]] ?? "";
    $rows[] = $row;
}

// Add "duplicate" flag to each row
$duplicateGroups = 0;
foreach ($keywordCount as $kw => $count) {
    if ($count > 1) {
        $duplicateGroups++;
    }
}

// Mark duplicates
foreach ($rows as &$row) {
    $fk = trim(strtolower($row['focus_keyword'] ?? ""));
    $row['duplicate'] = ($fk !== "" && $keywordCount[$fk] > 1);
}

// FILTER rows if only_duplicate = 1
if ($onlyDuplicate === 1) {
    $rows = array_values(array_filter($rows, function ($r) {
        return $r['duplicate'] === true;
    }));
}
echo json_encode([
    "status" => "success",
    "payload" => [...$payload, true],
    "post_type" => $post_type,
    "data" => $rows,
    "keywordCount" => $keywordCount,
]);

exit;
