<?php
/**
 * POST api/save - create or update an option (CSRF-protected).
 *
 * action=create: {option_name, option_value, autoload}
 * action=update: {option_id, option_value?, option_name?, autoload?}
 */
require_once __DIR__ . '/_bootstrap.php';

require_post();
require_auth();
require_csrf();

require_once __DIR__ . '/_db.php';
$conn = require_db();

$action = (string) ($_POST['action'] ?? '');

if ($action === 'create') {

    $name     = trim((string) ($_POST['option_name'] ?? ''));
    $value    = (string) ($_POST['option_value'] ?? '');
    $autoload = trim((string) ($_POST['autoload'] ?? 'yes'));

    if ($name === '' || strlen($name) > 191) {
        json_error('Option name is required (max 191 characters).', 422);
    }
    if ($autoload === '' || strlen($autoload) > 20) {
        json_error('Autoload must be 1–20 characters.', 422);
    }

    try {
        $stmt = $conn->prepare(
            'INSERT INTO wp_options (option_name, option_value, autoload) VALUES (?, ?, ?)'
        );
        $stmt->bind_param('sss', $name, $value, $autoload);
        $stmt->execute();
        $newId = (int) $conn->insert_id;
        $stmt->close();
    } catch (mysqli_sql_exception $e) {
        if ((int) $e->getCode() === 1062) {
            json_error("An option named \"{$name}\" already exists.", 409);
        }
        json_error('Insert failed: ' . $e->getMessage(), 500);
    }

    json_out(['success' => true, 'message' => 'Option created.', 'option_id' => $newId]);
}

if ($action === 'update') {

    $id = (int) ($_POST['option_id'] ?? 0);
    if ($id <= 0) {
        json_error('A valid option id is required.', 422);
    }

    $sets   = [];
    $params = [];
    $types  = '';

    if (array_key_exists('option_name', $_POST)) {
        $name = trim((string) $_POST['option_name']);
        if ($name === '' || strlen($name) > 191) {
            json_error('Option name is required (max 191 characters).', 422);
        }
        $sets[]   = 'option_name = ?';
        $params[] = $name;
        $types   .= 's';
    }

    if (array_key_exists('option_value', $_POST)) {
        $sets[]   = 'option_value = ?';
        $params[] = (string) $_POST['option_value'];
        $types   .= 's';
    }

    if (array_key_exists('autoload', $_POST)) {
        $autoload = trim((string) $_POST['autoload']);
        if ($autoload === '' || strlen($autoload) > 20) {
            json_error('Autoload must be 1–20 characters.', 422);
        }
        $sets[]   = 'autoload = ?';
        $params[] = $autoload;
        $types   .= 's';
    }

    if (!$sets) {
        json_error('Nothing to update.', 422);
    }

    $params[] = $id;
    $types   .= 'i';

    try {
        $stmt = $conn->prepare(
            'UPDATE wp_options SET ' . implode(', ', $sets) . ' WHERE option_id = ?'
        );
        $stmt->bind_param($types, ...$params);
        $stmt->execute();
        $affected = $stmt->affected_rows;
        $stmt->close();
    } catch (mysqli_sql_exception $e) {
        if ((int) $e->getCode() === 1062) {
            json_error('Another option already uses that name.', 409);
        }
        json_error('Update failed: ' . $e->getMessage(), 500);
    }

    json_out([
        'success' => true,
        'message' => $affected > 0 ? 'Option updated.' : 'No changes made.',
    ]);
}

json_error('Unknown action. Use "create" or "update".', 422);
