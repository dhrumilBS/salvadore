<?php
header('Content-Type: application/json; charset=utf-8');
require __DIR__ . '/../../conn.php';

$validTemplates = [
    'HIMS' => 'templates/template-city-page.php',
    'HMS' => 'templates/template-state-city.php',
    'EMR' => 'templates/%emr%state.php',
    'EHR' => 'templates/%ehr%state.php',
    'PMS' => 'templates/%pms%state.php',
    'LAB' => 'templates/%lab%state.php',
    'INTERNATIONAL' => 'templates/template-hms-international.php',
    'META' => '',
];

$template = isset($_GET['template']) ? trim($_GET['template']) : 'All';
$templateKey = strtoupper($template);
$best = isset($_GET['best']) ? trim($_GET['best']) : '';

if ($templateKey !== 'ALL' && !array_key_exists($templateKey, $validTemplates)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Invalid template selection']);
    exit;
}

if ($templateKey === 'ALL') {
    $tArray = $validTemplates;
    unset($tArray['META']);
    $headerText = 'All Templates';
} elseif ($templateKey === 'META') {
    $bestKey = $best !== '' ? strtolower($best) : 'hms';
    $bestClean = $conn->real_escape_string($bestKey);
    $tArray = ['META' => "templates/template-{$bestClean}-state.php"];
    $headerText = 'Meta Template: ' . htmlspecialchars($bestClean);
} else {
    $tArray = [$templateKey => $validTemplates[$templateKey]];
    $headerText = ucfirst(strtolower($templateKey));
}

$state = [];
foreach ($tArray as $t_name => $t_value) {
    $query = "SELECT
        p.id AS main_id,
        p.guid AS main_guid,
        p.post_name AS main_post_name,
        p.post_title AS main_post_title,
        p.post_status AS main_post_status,
        sub_p.id AS sub_id,
        sub_p.guid AS sub_guid,
        sub_p.post_name AS sub_post_name,
        sub_p.post_title AS sub_post_title,
        sub_p.post_status AS sub_post_status
    FROM wp_posts p
    INNER JOIN wp_postmeta pm ON p.id = pm.post_id
    LEFT JOIN wp_postmeta sub_pm ON sub_pm.meta_value = p.id
    LEFT JOIN wp_posts sub_p ON sub_pm.post_id = sub_p.id AND sub_p.post_type = 'page'
    WHERE p.post_type = 'page' AND pm.meta_value LIKE '$t_value'
    ORDER BY p.post_title ASC, sub_p.post_title ASC";

    $res = $conn->query($query);
    if ($res && $res->num_rows > 0) {
        $temp_array = [];
        $last_main_id = null;

        while ($row = $res->fetch_assoc()) {
            $main_id = $row['main_id'];
            if ($main_id !== $last_main_id && $last_main_id !== null) {
                $state[count($state) - 1]['cityData'] = $temp_array;
                $temp_array = [];
            }

            if ($main_id !== $last_main_id) {
                $state[] = [
                    'id' => $row['main_id'],
                    'guid' => $row['main_guid'],
                    'post_name' => $row['main_post_name'],
                    'post_title' => $row['main_post_title'],
                    'post_status' => $row['main_post_status'],
                    'template' => $t_name,
                ];
                $last_main_id = $main_id;
            }

            if (!empty($row['sub_id'])) {
                $temp_array[] = [
                    'id' => $row['sub_id'],
                    'guid' => $row['sub_guid'],
                    'post_name' => $row['sub_post_name'],
                    'post_title' => $row['sub_post_title'],
                    'post_status' => $row['sub_post_status'],
                ];
            }
        }

        if (!empty($temp_array) && count($state) > 0) {
            $state[count($state) - 1]['cityData'] = $temp_array;
        }
    }
}

echo json_encode([
    'success' => true,
    'template' => $templateKey,
    'headerText' => $headerText,
    'data' => $state,
], JSON_UNESCAPED_UNICODE);
