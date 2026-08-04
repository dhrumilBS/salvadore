<?php
/*
 * Shared whitelists for the content export tool. Keys here are verified
 * against the live wp_postmeta table (SHOW COLUMNS / DISTINCT meta_key) -
 * this install's Yoast SEO stores meta under the "_yoast_wpseo_" prefix,
 * not the bare "_wpseo_" prefix Yoast's docs use elsewhere.
 */

/** Internal/system post types never shown as exportable content. */
function dw_excluded_post_types()
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
    ];
}

/** Post types selected by default when no post_type filter is supplied. */
function dw_default_post_types()
{
    return ['post', 'page'];
}

/**
 * The only postmeta keys this tool ever reads: Yoast's meta title/meta
 * description for display, plus the primary-category hint used to
 * reconstruct a post's real permalink (category-based permalink structure).
 */
function dw_needed_meta_keys()
{
    return ['_yoast_wpseo_title', '_yoast_wpseo_metadesc', '_yoast_wpseo_primary_category'];
}

/** sort key (as sent by the client) => safe SQL order-by expression. */
function dw_sort_columns()
{
    return [
        'post_date'     => 'p.post_date',
        'post_modified' => 'p.post_modified',
        'title'         => 'p.post_title',
        'menu_order'    => 'p.menu_order',
        'author'        => 'author_name',
    ];
}
