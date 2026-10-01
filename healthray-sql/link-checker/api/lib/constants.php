<?php
/* Shared whitelists for the Link & UTM Checker. */

/**
 * Internal/system post types never treated as checkable content. Matches
 * ../healthray-sql/datewise's dw_excluded_post_types() (verified against the
 * same live sites) plus a couple this tool also ran into.
 */
function lc_excluded_post_types()
{
    return [
        'attachment',
        'acf-field',
        'acf-field-group',
        'acf-ui-options-page',
        'acf-post-type',
        'audioplayer',
        'cf7_to_any_api',
        'elementor_library',
        'elementor_font',
        'elementor_icons',
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
        'wp_font_face',
        'wpcode',
        'wpforms',
        'frm_styles',
        'frm_form_actions',
        'aiosrs-schema',
        'option-tree',
    ];
}

/** Every post status the UI can filter by. */
function lc_post_statuses()
{
    return [
        'publish' => 'Published',
        'draft'   => 'Draft',
        'pending' => 'Pending',
        'private' => 'Private',
        'future'  => 'Scheduled',
        'trash'   => 'Trash',
        'any'     => 'Any status',
    ];
}

/** Hard cap on posts fetched/extracted in one request — protects memory on very large sites. */
function lc_row_cap()
{
    return 3000;
}
