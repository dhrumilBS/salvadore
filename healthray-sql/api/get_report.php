<?php
header('Content-Type: application/json');

/* ── Read & validate JSON body ── */
$raw  = file_get_contents("php://input");
$data = json_decode($raw, true);

if (json_last_error() !== JSON_ERROR_NONE) {
    echo json_encode(['status' => 'error', 'error' => 'Invalid JSON input']);
    exit;
}

/* ── Select database (unknown keys fall back to default in conn.php) ── */
$ACTIVE_DB = $data['db'] ?? 'landing';
require $_SERVER['DOCUMENT_ROOT'] . '/salvadore/healthray-sql/conn.php';

$from  = $data['from']  ?? null;
$to    = $data['to']    ?? null;
$limit = isset($data['limit']) ? (int)$data['limit'] : 10000;
if ($limit < 1 || $limit > 50000) $limit = 10000;

/* ── Validate date format (YYYY-MM-DD) ── */
function isValidDate($d)
{
    if (!$d) return false;
    $dt = DateTime::createFromFormat('Y-m-d', $d);
    return $dt && $dt->format('Y-m-d') === $d;
}

if (!isValidDate($from) || !isValidDate($to)) {
    echo json_encode(['status' => 'error', 'error' => 'Invalid or missing date parameters']);
    exit;
}

/*
 * Range bounds: avoid DATE() wrapper on the column so MySQL can use
 * an index on created_date (e.g. INDEX idx_created_date (created_date)).
 * DATE(col) >= ? forces a full-table scan even with an index in place.
 */
$fromTs = $from . ' 00:00:00';
$toTs   = $to   . ' 23:59:59';

/* ── Safe query using prepared statement ── */
$stmt = $conn->prepare(
    "SELECT form_data, created_date 
     FROM   wp_cf7anyapi_logs
     WHERE  created_date >= ?
       AND  created_date <= ?
     ORDER  BY created_date DESC
     LIMIT  ?"
);

if (!$stmt) {
    echo json_encode(['status' => 'error', 'error' => 'Query prepare failed: ' . $conn->error]);
    exit;
}

$stmt->bind_param("ssi", $fromTs, $toTs, $limit);
$stmt->execute();
$result = $stmt->get_result();

/* ── Decode rows ── */
$rows      = [];
$allColSet = [];          // ordered array — preserves first-seen order
$allColMap = [];          // hash for O(1) duplicate check (replaces in_array loop)

while ($r = $result->fetch_assoc()) {
    $decoded = json_decode($r['form_data'], true);
    if (!is_array($decoded)) continue;          // skip malformed rows
    $decoded['created_date'] = $r['created_date'];
    foreach (array_keys($decoded) as $col) {
        if (!isset($allColMap[$col])) {
            $allColMap[$col] = true;
            $allColSet[]     = $col;
        }
    }

    $rows[] = $decoded;
}

$stmt->close();

/* ── Guard: no rows ── */
if (empty($rows)) {
    echo json_encode([
        'status'     => 'success',
        'total'      => 0,
        'rows'       => [],
        'allColumns' => [],
        'defaultShow' => [],
    ]);
    exit;
}

/* ── Default visible columns ── */
$defaultShow = [
    'your-name',
    'your-email',
    'your-number',
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'your-country',
    'your-city',
    'submit_time',
    'handl_url_cf7-264',
];

/* Only include defaultShow cols that actually exist in the data */
$defaultShow = array_values(array_intersect($allColSet, $defaultShow));

echo json_encode([
    'status'      => 'success',
    'total'       => count($rows),
    'truncated'   => count($rows) >= $limit,   // true → more rows exist beyond the limit
    'limit'       => $limit,
    'rows'        => $rows,
    'allColumns'  => $allColSet,
    'defaultShow' => $defaultShow,
]);
