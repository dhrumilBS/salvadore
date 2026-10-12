<?php
/*
 * Menu Order tab (former ../menu-order/ tool) - shared helpers.
 * Required by api/menu_types.php, menu_list.php and menu_save.php only
 * (not by bootstrap.php). Everything is mo_-prefixed.
 */

/** Plumbing post types that never need ordering in this tab. */
const MO_SYSTEM_POST_TYPES = [
    'attachment', 'revision', 'nav_menu_item', 'acf-field', 'acf-field-group',
    'acf-post-type', 'acf-ui-options-page', 'elementor_library', 'elementor_icons',
    'elementor_font', 'custom_css', 'cf7_to_any_api', 'wpcf7_contact_form',
    'option-tree', 'customize_changeset', 'wp_global_styles', 'wp_block',
    'wp_navigation', 'aiosrs-schema', 'frm_styles', 'frm_form_actions',
    'wpcode', 'wpforms', 'themo_portfolio', 'e-landing-page', 'oembed_cache',
    'user_request', 'wp_template', 'wp_template_part', 'wp_font_family', 'wp_font_face',
];

function mo_wp_option($conn, $name)
{
    $stmt = $conn->prepare('SELECT option_value FROM wp_options WHERE option_name = ? LIMIT 1');
    $stmt->bind_param('s', $name);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    return $row ? $row['option_value'] : null;
}

/**
 * The site's timezone, resolved the way WordPress does: a named zone if one
 * is set, otherwise the numeric gmt_offset.
 */
function mo_site_timezone($conn)
{
    $name = (string) mo_wp_option($conn, 'timezone_string');
    if ($name !== '') {
        try {
            return new DateTimeZone($name);
        } catch (Exception $e) { /* fall through to the offset */
        }
    }
    $offset = (float) mo_wp_option($conn, 'gmt_offset');
    $sign   = $offset < 0 ? '-' : '+';
    $abs    = abs($offset);
    $hours  = (int) floor($abs);
    $mins   = (int) round(($abs - $hours) * 60);
    return new DateTimeZone(sprintf('%s%02d:%02d', $sign, $hours, $mins));
}

/**
 * Same rules as WordPress' sanitize_title_with_dashes() for plain ASCII
 * slugs: lowercase, spaces/underscores/dots/slashes to dashes, drop the rest.
 * Mirrored client-side by moSanitizeSlug() in js/menu-order.js.
 */
function mo_sanitize_slug($slug)
{
    $slug = strtolower(trim((string) $slug));
    $slug = preg_replace('/[\s_.\/]+/', '-', $slug);
    $slug = preg_replace('/[^a-z0-9%-]/', '', $slug);
    $slug = preg_replace('/-+/', '-', $slug);
    return trim($slug, '-');
}

/** Post types with at least one published item, minus plumbing types. [{post_type, count}] */
function mo_selectable_post_types($conn)
{
    $types = [];
    $r = $conn->query("SELECT post_type, COUNT(*) c FROM wp_posts WHERE post_status = 'publish' GROUP BY post_type ORDER BY c DESC");
    while ($r && $row = $r->fetch_assoc()) {
        if (!in_array($row['post_type'], MO_SYSTEM_POST_TYPES, true)) {
            $types[] = ['post_type' => $row['post_type'], 'count' => (int) $row['c']];
        }
    }
    return $types;
}
