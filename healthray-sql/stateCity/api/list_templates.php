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
    'OTHER' => null,
];

// Patterns that identify a state-city page under one of the known
// templates above - both the "state" (parent) template and its linked
// "city" (child) template, including any META bestKey variant (e.g.
// hms/emr/ehr/pms/lab-state.php). Used to find pages that DON'T match any
// of them.
$knownTemplateLikePatterns = [
    'templates/template-city-page.php',
    'templates/template-state-city.php',
    'templates/template-city.php',
    '%emr%state.php',
    '%ehr%state.php',
    '%pms%state.php',
    '%lab%state.php',
    '%state-city.php',
    'templates/template-hms-international.php',
    'templates/template-%-state.php',
];

$template = isset($_GET['template']) ? trim($_GET['template']) : 'All';
$templateKey = strtoupper($template);
$best = isset($_GET['best']) ? trim($_GET['best']) : '';

if ($templateKey !== 'ALL' && !array_key_exists($templateKey, $validTemplates)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Invalid template selection']);
    exit;
}

$state = [];

if ($templateKey === 'OTHER') {
    // Every page NOT using one of the known state-city templates - i.e.
    // pages built with Elementor (or its default/canvas/header-footer
    // templates) or any other standalone PHP page template.
    $headerText = 'Other Pages (No State-City Template)';
    $excludeSql = implode(' OR ', array_map(
        fn($p) => "pm2.meta_value LIKE '" . $conn->real_escape_string($p) . "'",
        $knownTemplateLikePatterns
    ));

    // A correlated subquery (rather than a LEFT JOIN) for the template value
    // guarantees exactly one row per post even if a post has more than one
    // stray _wp_page_template meta row.
    $query = "SELECT
            p.id AS id,
            p.guid AS guid,
            p.post_name AS post_name,
            p.post_title AS post_title,
            p.post_status AS post_status,
            (SELECT pm.meta_value FROM wp_postmeta pm
                WHERE pm.post_id = p.id AND pm.meta_key = '_wp_page_template'
                ORDER BY pm.meta_id DESC LIMIT 1) AS page_template
        FROM wp_posts p
        WHERE p.post_type = 'page'
          AND p.post_status != 'auto-draft'
          AND NOT EXISTS (
              SELECT 1 FROM wp_postmeta pm2
              WHERE pm2.post_id = p.id AND ($excludeSql)
          )
        ORDER BY p.post_title ASC";

    $res = $conn->query($query);
    if ($res) {
        while ($row = $res->fetch_assoc()) {
            $rawTemplate = trim((string) $row['page_template']);
            $state[] = [
                'id' => $row['id'],
                'guid' => $row['guid'],
                'post_name' => $row['post_name'],
                'post_title' => $row['post_title'],
                'post_status' => $row['post_status'],
                'template' => $rawTemplate === '' || $rawTemplate === 'default' ? 'Elementor / Default' : $rawTemplate,
            ];
        }
    }

    echo json_encode([
        'success' => true,
        'template' => $templateKey,
        'headerText' => $headerText,
        'data' => $state,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

if ($templateKey === 'ALL') {
    $tArray = $validTemplates;
    unset($tArray['META'], $tArray['OTHER']);
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
