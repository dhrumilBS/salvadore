<?php
header("Content-Type: application/json");
require $_SERVER['DOCUMENT_ROOT'] . '/salvadore/healthray-sql/conn.php';

$action = $_GET['action'] ?? $_POST['action'] ?? '';
$result = '';

const OPT_BASE = 'wpseo-premium-redirects-base';
const OPT_PLAIN = 'wpseo-premium-redirects-export-plain';

if ($action === 'preview_update') {
    // Dry run only — builds both serialized formats and returns them for review.
    // Nothing is written to wp_options here.
    $input = json_decode(file_get_contents("php://input"), true);
    $entries = $input['entries'] ?? null;

    if (!is_array($entries)) {
        $result = ['success' => false, 'msg' => 'Missing or invalid "entries" array'];
    } else {
        $base = [];
        $plain = [];
        $i = 0;
        foreach ($entries as $e) {
            $origin = trim((string)($e['origin'] ?? ''));
            if ($origin === '') continue;
            $url = (string)($e['url'] ?? '');
            $type = (int)($e['type'] ?? 301);

            $base[$origin] = ['url' => $url, 'type' => $type];
            $plain[$i] = ['origin' => $origin, 'url' => $url, 'type' => $type, 'format' => 'plain'];
            $i++;
        }

        $result = [
            'success' => true,
            'msg' => 'Preview generated — not saved to the database',
            'base' => [
                'option_name' => OPT_BASE,
                'serialized' => serialize($base),
                'count' => count($base),
            ],
            'plain' => [
                'option_name' => OPT_PLAIN,
                'serialized' => serialize($plain),
                'count' => count($plain),
            ],
        ];
    }
} else {
    $optName = OPT_BASE;
    $sql = "SELECT option_value FROM wp_options WHERE option_name = ?";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('s', $optName);
    $stmt->execute();
    $res = $stmt->get_result();

    $data = [];
    if ($res && $res->num_rows > 0) {
        while ($row = $res->fetch_assoc()) {
            $opt_v = @unserialize($row['option_value'], ['allowed_classes' => false]);
            if ($opt_v !== false || $row['option_value'] === 'b:0;') {
                $row['option_value'] = $opt_v;
            }
            $data = $row['option_value'];
        }
        $result = ['data' => $data, 'success' => true, 'msg' => 'Data fetched successfully'];
    } elseif ($res) {
        $result = ['data' => [], 'success' => false, 'msg' => 'No data found'];
    } else {
        $result = ['data' => [], 'success' => false, 'msg' => 'Query failed', 'error' => $conn->error];
    }
}

echo json_encode($result);
