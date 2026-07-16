<?php
require $_SERVER['DOCUMENT_ROOT'] . '/salvadore/healthray-sql/conn.php';

header("Content-Type: application/json");


$excluded = [
    "acf-field",
    "acf-field-group",
    "acf-ui-options-page",
    "audioplayer",
    "cf7_to_any_api",
    "elementor_library",
    "wpcf7_contact_form",
    'revision',
    'nav_menu_item',
    'custom_css',
    'customize_changeset',
    'oembed_cache',
    'user_request',
    'wp_block',
    'wp_template',
    'wp_template_part',
    'wp_global_styles',
    'wp_navigation',
    'wp_font_family',
    'wp_font_face',
];

// Fetch unique post types
$sql = "SELECT DISTINCT post_type FROM wp_posts WHERE post_type NOT IN (
    'acf-field',
    'acf-field-group',
    'acf-ui-options-page',
    'audioplayer',
    'cf7_to_any_api',
    'elementor_library',
    'wpcf7_contact_form',
    'revision',
    'nav_menu_item',
    'custom_css',
    'customize_changeset',
    'oembed_cache',
    'user_request',
    'wp_block',
    'wp_template',
    'wp_template_part',
    'wp_global_styles',
    'wp_navigation',
    'wp_font_family',
    'wp_font_face'
) ORDER BY post_type ASC";
$result = $conn->query($sql);

$postTypes = [];
while ($row = $result->fetch_assoc()) {
    $postTypes[] = $row['post_type'];
}

echo json_encode([
    "post_types" => $postTypes
]);
