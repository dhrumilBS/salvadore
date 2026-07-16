<?php
/**
 * GET api/options — paginated, sortable search over wp_options.
 *
 * Params: db, column, match (contains|exact|starts|ends), value,
 *         page, per (10–200), sort, dir (asc|desc)
 * option_value is truncated to 300 chars in the list; full value via api/option.
 */
require_once __DIR__ . '/_bootstrap.php';

require_auth();

require_once __DIR__ . '/_db.php';
$conn = require_db();

$column = (string) ($_GET['column'] ?? 'option_name');
if (!in_array($column, WP_OPTION_COLUMNS, true)) {
    json_error('Invalid search column.', 422);
}

$match = (string) ($_GET['match'] ?? 'contains');
if (!in_array($match, MATCH_MODES, true)) {
    $match = 'contains';
}

$value = (string) ($_GET['value'] ?? '');

$sort = (string) ($_GET['sort'] ?? 'option_id');
if (!in_array($sort, WP_OPTION_COLUMNS, true)) {
    $sort = 'option_id';
}
$dir = strtolower((string) ($_GET['dir'] ?? 'asc')) === 'desc' ? 'DESC' : 'ASC';

$page = max(1, (int) ($_GET['page'] ?? 1));
$per  = min(200, max(10, (int) ($_GET['per'] ?? 25)));

/* WHERE clause — column name comes from the whitelist above, never from raw input */
$where  = '';
$params = [];
if ($value !== '') {
    if ($match === 'exact') {
        $where    = "WHERE `$column` = ?";
        $params[] = $value;
    } else {
        $where    = "WHERE `$column` LIKE ?";
        $params[] = like_pattern($value, $match);
    }
}

try {
    /* Total count */
    $stmt = $conn->prepare("SELECT COUNT(*) AS total FROM wp_options $where");
    if ($params) {
        $stmt->bind_param('s', $params[0]);
    }
    $stmt->execute();
    $total = (int) $stmt->get_result()->fetch_assoc()['total'];
    $stmt->close();

    $pages  = max(1, (int) ceil($total / $per));
    $page   = min($page, $pages);
    $offset = ($page - 1) * $per;

    /* Rows (option_value truncated for the list view) */
    $sql = "SELECT option_id, option_name,
                   LEFT(option_value, 300) AS option_value,
                   CHAR_LENGTH(option_value) AS value_length,
                   autoload
            FROM wp_options $where
            ORDER BY `$sort` $dir
            LIMIT ? OFFSET ?";
    $stmt = $conn->prepare($sql);
    if ($params) {
        $stmt->bind_param('sii', $params[0], $per, $offset);
    } else {
        $stmt->bind_param('ii', $per, $offset);
    }
    $stmt->execute();
    $result = $stmt->get_result();

    $rows = [];
    while ($row = $result->fetch_assoc()) {
        $row['option_id']    = (int) $row['option_id'];
        $row['value_length'] = (int) $row['value_length'];
        $rows[] = $row;
    }
    $stmt->close();
} catch (mysqli_sql_exception $e) {
    json_error('Query failed: ' . $e->getMessage(), 500);
}

$dbKey = db_resolve_key();

json_out([
    'success' => true,
    'rows'    => $rows,
    'total'   => $total,
    'page'    => $page,
    'pages'   => $pages,
    'per'     => $per,
    'db'      => $dbKey,
    'dbLabel' => $DATABASES[$dbKey]['label'] ?? $dbKey,
]);
