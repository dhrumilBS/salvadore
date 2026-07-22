<?php
/**
 * GET api/option - full single row (untruncated option_value).
 * Params: id, db
 */
require_once __DIR__ . '/_bootstrap.php';

require_auth();

require_once __DIR__ . '/_db.php';
$conn = require_db();

$id = (int) ($_GET['id'] ?? 0);
if ($id <= 0) {
    json_error('A valid option id is required.', 422);
}

try {
    $stmt = $conn->prepare(
        'SELECT option_id, option_name, option_value, autoload FROM wp_options WHERE option_id = ?'
    );
    $stmt->bind_param('i', $id);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();
} catch (mysqli_sql_exception $e) {
    json_error('Query failed: ' . $e->getMessage(), 500);
}

if (!$row) {
    json_error('Option not found.', 404);
}

$row['option_id'] = (int) $row['option_id'];

json_out(['success' => true, 'option' => $row]);
