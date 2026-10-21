<?php
/*
 * Shared whitelists for every tab. Keys here are verified against the live
 * wp_postmeta table (SHOW COLUMNS / DISTINCT meta_key) - this install's Yoast
 * SEO stores meta under the "_yoast_wpseo_" prefix, not the bare "_wpseo_"
 * prefix Yoast's docs use elsewhere.
 */

/** Internal/system post types never shown as content (Content, Links, Bulk tabs alike). */
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
        'option-tree',
        'wpcf7r_action',  // Contact Form 7 redirection actions (Botphonic)
        'e_global_class', // Elementor global CSS classes (Botphonic)
    ];
}

/** Post types selected by default when no post_type filter is supplied. */
function dw_default_post_types()
{
    return ['post', 'page'];
}

/** Every status a filter dropdown can offer (value => label). "any" is filter-only. */
function dw_post_statuses()
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

/** Statuses a post can actually be written to (update_post / bulk_update_status). */
function dw_writable_statuses()
{
    return ['publish', 'draft', 'pending', 'private', 'future', 'trash'];
}

/**
 * The only postmeta keys this tool ever reads: Yoast's meta title/meta
 * description for display, plus the primary-category hint used to
 * reconstruct a post's real permalink (category-based permalink structure).
 */
function dw_needed_meta_keys()
{
    return ['_yoast_wpseo_title', '_yoast_wpseo_metadesc', '_yoast_wpseo_primary_category',
        '_yoast_wpseo_meta-robots-noindex', '_yoast_wpseo_meta-robots-nofollow'];
}

/**
 * sort key (as sent by the client) => safe SQL order-by expression. The Content
 * tab's column headers sort by these keys (js/content.js SORT_KEYS); meta and
 * category sorts are correlated subqueries, fine at a few thousand posts.
 */
function dw_sort_columns()
{
    $meta = fn($key) => "(SELECT pm.meta_value FROM wp_postmeta pm WHERE pm.post_id = p.ID AND pm.meta_key = '$key' LIMIT 1)";
    return [
        'post_date'        => 'p.post_date',
        'post_modified'    => 'p.post_modified',
        'title'            => 'p.post_title',
        'menu_order'       => 'p.menu_order',
        'author'           => 'author_name',
        'id'               => 'p.ID',
        'post_type'        => 'p.post_type',
        'slug'             => 'p.post_name',
        'status'           => 'p.post_status',
        // First category name A-Z - the same name the Category column lists first.
        'category'         => "(SELECT MIN(t.name) FROM wp_term_relationships tr
                                INNER JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'category'
                                INNER JOIN wp_terms t ON t.term_id = tt.term_id
                                WHERE tr.object_id = p.ID)",
        // An empty Yoast title shows the post title (dw_hydrate_batch), so it sorts as one too.
        'meta_title'       => "COALESCE(NULLIF({$meta('_yoast_wpseo_title')}, ''), p.post_title)",
        'meta_description' => $meta('_yoast_wpseo_metadesc'),
        'robots_index'     => $meta('_yoast_wpseo_meta-robots-noindex'),
        'robots_follow'    => $meta('_yoast_wpseo_meta-robots-nofollow'),
    ];
}

/** Hard cap on posts fetched + link-extracted in one Links-tab request - protects memory on very large sites. */
function dw_links_row_cap()
{
    return 3000;
}
