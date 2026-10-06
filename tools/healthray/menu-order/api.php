<?php
header('Content-Type: application/json; charset=utf-8');

if (!ini_get('zlib.output_compression') && extension_loaded('zlib')) {
    ob_start('ob_gzhandler');
}

/*
 * Which site's database to use - this tool's own "mo_db" cookie, so switching
 * sites here never affects the other healthray-sql tools. When it isn't set,
 * conn.php falls back to the shared "db" cookie / its default, as before.
 */
$ACTIVE_DB = $_COOKIE['mo_db'] ?? null;
require __DIR__ . '/../conn.php';
$conn->set_charset('utf8mb4');

$action = $_GET['action'] ?? 'list';

function respond($payload, $code = 200)
{
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function wp_option($conn, $name)
{
    $stmt = $conn->prepare('SELECT option_value FROM wp_options WHERE option_name = ? LIMIT 1');
    $stmt->bind_param('s', $name);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    return $row ? $row['option_value'] : null;
}

// The site's timezone, the same way WordPress resolves it: a named zone
// if one is set, otherwise the numeric gmt_offset.
function site_timezone($conn)
{
    $name = (string) wp_option($conn, 'timezone_string');
    if ($name !== '') {
        try {
            return new DateTimeZone($name);
        } catch (Exception $e) { /* fall through to the offset */
        }
    }
    $offset = (float) wp_option($conn, 'gmt_offset');
    $sign   = $offset < 0 ? '-' : '+';
    $abs    = abs($offset);
    return new DateTimeZone(sprintf('%s%02d:%02d', $sign, floor($abs), round(($abs - floor($abs)) * 60)));
}

// Same rules as WordPress' sanitize_title_with_dashes() for plain ASCII
// slugs: lowercase, spaces/underscores/dots to dashes, drop anything else.
function sanitize_slug($slug)
{
    $slug = strtolower(trim((string) $slug));
    $slug = preg_replace('/[\s_.\/]+/', '-', $slug);
    $slug = preg_replace('/[^a-z0-9%-]/', '', $slug);
    $slug = preg_replace('/-+/', '-', $slug);
    return trim($slug, '-');
}

// Plumbing post types that never need ordering in this tool.
const SYSTEM_POST_TYPES = [
    'attachment', 'revision', 'nav_menu_item', 'acf-field', 'acf-field-group',
    'acf-post-type', 'acf-ui-options-page', 'elementor_library', 'elementor_icons',
    'elementor_font', 'custom_css', 'cf7_to_any_api', 'wpcf7_contact_form',
    'option-tree', 'customize_changeset', 'wp_global_styles', 'wp_block',
    'wp_navigation', 'aiosrs-schema', 'frm_styles', 'frm_form_actions',
    'wpcode', 'wpforms', 'themo_portfolio', 'e-landing-page', 'oembed_cache',
    'user_request', 'wp_template', 'wp_template_part', 'wp_font_family', 'wp_font_face',
];

function selectable_post_types($conn)
{
    $types = [];
    $r = $conn->query("SELECT post_type, COUNT(*) c FROM wp_posts WHERE post_status = 'publish' GROUP BY post_type ORDER BY c DESC");
    while ($r && $row = $r->fetch_assoc()) {
        if (!in_array($row['post_type'], SYSTEM_POST_TYPES, true)) {
            $types[] = ['post_type' => $row['post_type'], 'count' => (int) $row['c']];
        }
    }
    return $types;
}

// ─── ACTION: databases (site switcher) ────────────────────────────────────────
if ($action === 'databases') {
    $list = [];
    foreach ($DATABASES as $key => $cfg) {
        $list[] = ['key' => $key, 'label' => $cfg['label'] ?? $key];
    }
    respond(['status' => 'success', 'databases' => $list, 'current' => db_resolve_key()]);
}

// ─── ACTION: post_types ───────────────────────────────────────────────────────
if ($action === 'post_types') {
    respond(['status' => 'success', 'post_types' => selectable_post_types($conn)]);
}

// ─── ACTION: list — every published item of one post type ─────────────────────
if ($action === 'list') {
    $allowed  = array_column(selectable_post_types($conn), 'post_type');
    $postType = in_array($_GET['type'] ?? 'page', $allowed, true) ? $_GET['type'] : 'page';

    $stmt = $conn->prepare(
        "SELECT ID, post_title, post_name, post_parent, menu_order, post_date, post_modified
         FROM wp_posts
         WHERE post_type = ? AND post_status = 'publish'
         ORDER BY menu_order ASC, post_title ASC"
    );
    $stmt->bind_param('s', $postType);
    $stmt->execute();
    $res = $stmt->get_result();

    $items = [];
    while ($row = $res->fetch_assoc()) {
        $items[] = [
            'id'         => (int) $row['ID'],
            'title'      => $row['post_title'],
            'slug'       => $row['post_name'],
            'parent'     => (int) $row['post_parent'],
            'menu_order' => (int) $row['menu_order'],
            'date'       => $row['post_date'],
            'modified'   => $row['post_modified'],
        ];
    }

    // Parents that aren't in the list (unpublished, or another type) still
    // need a title + slug so paths and the parent filter can show them.
    $known   = array_flip(array_column($items, 'id'));
    $missing = array_values(array_unique(array_filter(
        array_column($items, 'parent'),
        fn($p) => $p > 0 && !isset($known[$p])
    )));
    $parents = [];
    if ($missing) {
        $idList = implode(',', array_map('intval', $missing));
        $r = $conn->query("SELECT ID, post_title, post_name, post_parent FROM wp_posts WHERE ID IN ({$idList})");
        while ($r && $p = $r->fetch_assoc()) {
            $parents[] = ['id' => (int) $p['ID'], 'title' => $p['post_title'], 'slug' => $p['post_name'], 'parent' => (int) $p['post_parent']];
        }
    }

    respond([
        'status'    => 'success',
        'post_type' => $postType,
        'site_url'  => rtrim((string) wp_option($conn, 'siteurl'), '/'),
        'items'     => $items,
        'parents'   => $parents,
    ]);
}

// ─── ACTION: save — apply a batch of edits atomically ─────────────────────────
// Body: { post_type, changes: [ { id, modified, title?, slug?, date?, menu_order? } ] }
// Every change is validated first; if any fails nothing is written.
if ($action === 'save' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $body     = json_decode(file_get_contents('php://input'), true) ?: [];
    $changes  = $body['changes'] ?? [];
    $postType = (string) ($body['post_type'] ?? 'page');

    if (!$changes || !is_array($changes)) {
        respond(['status' => 'error', 'message' => 'No changes provided'], 400);
    }

    $tz      = site_timezone($conn);
    $errors  = [];
    $planned = [];

    $fetch = $conn->prepare('SELECT ID, post_type, post_parent, post_modified FROM wp_posts WHERE ID = ? LIMIT 1');
    $slugTaken = $conn->prepare(
        "SELECT ID FROM wp_posts
         WHERE post_name = ? AND post_type = ? AND post_parent = ? AND ID <> ?
           AND post_status NOT IN ('trash', 'auto-draft', 'inherit') LIMIT 1"
    );
    $batchSlugs = [];

    foreach ($changes as $c) {
        $id = (int) ($c['id'] ?? 0);
        $fail = function ($msg) use (&$errors, $id) {
            $errors[] = ['id' => $id, 'message' => $msg];
        };

        $fetch->bind_param('i', $id);
        $fetch->execute();
        $row = $fetch->get_result()->fetch_assoc();
        if (!$row) { $fail('Post not found'); continue; }
        if ($row['post_type'] !== $postType) { $fail('Post type mismatch'); continue; }

        // Someone (WordPress, another tab) saved this post after it was loaded.
        if (isset($c['modified']) && $c['modified'] !== $row['post_modified']) {
            $fail('Changed elsewhere since you loaded it — reload to get the latest version');
            continue;
        }

        $set = [];
        if (array_key_exists('title', $c)) {
            $title = trim((string) $c['title']);
            if ($title === '') { $fail('Title cannot be empty'); continue; }
            $set['post_title'] = $title;
        }
        if (array_key_exists('slug', $c)) {
            $slug = sanitize_slug($c['slug']);
            if ($slug === '') { $fail('Slug cannot be empty'); continue; }
            $parent = (int) $row['post_parent'];
            $slugTaken->bind_param('ssii', $slug, $postType, $parent, $id);
            $slugTaken->execute();
            $clash = $slugTaken->get_result()->fetch_assoc();
            if ($clash) { $fail("Slug “{$slug}” is already used by #{$clash['ID']}"); continue; }
            $batchKey = $parent . '/' . $slug;
            if (isset($batchSlugs[$batchKey])) { $fail("Slug “{$slug}” is used twice in this save"); continue; }
            $batchSlugs[$batchKey] = true;
            $set['post_name'] = $slug;
        }
        if (array_key_exists('date', $c)) {
            $raw = str_replace('T', ' ', trim((string) $c['date']));
            $dt  = DateTime::createFromFormat('Y-m-d H:i:s', $raw, $tz)
                ?: DateTime::createFromFormat('Y-m-d H:i', $raw, $tz);
            if (!$dt) { $fail('Invalid date'); continue; }
            $set['post_date']     = $dt->format('Y-m-d H:i:s');
            $set['post_date_gmt'] = (clone $dt)->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
        }
        if (array_key_exists('menu_order', $c)) {
            if (!is_numeric($c['menu_order']) || (int) $c['menu_order'] != $c['menu_order']) {
                $fail('Menu order must be a whole number');
                continue;
            }
            $set['menu_order'] = (int) $c['menu_order'];
        }
        if ($set) {
            $planned[] = ['id' => $id, 'set' => $set];
        }
    }

    if ($errors) {
        respond(['status' => 'invalid', 'errors' => $errors, 'message' => count($errors) . ' change(s) could not be saved — nothing was written']);
    }
    if (!$planned) {
        respond(['status' => 'success', 'updated' => 0, 'items' => []]);
    }

    $now    = new DateTime('now', $tz);
    $mod    = $now->format('Y-m-d H:i:s');
    $modGmt = (clone $now)->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');

    $conn->begin_transaction();
    try {
        foreach ($planned as $p) {
            $cols   = array_keys($p['set']);
            $values = array_values($p['set']);
            $sql    = 'UPDATE wp_posts SET ' . implode(', ', array_map(fn($col) => "{$col} = ?", $cols))
                . ', post_modified = ?, post_modified_gmt = ? WHERE ID = ?';
            $types  = implode('', array_map(fn($col) => $col === 'menu_order' ? 'i' : 's', $cols)) . 'ssi';
            $values = array_merge($values, [$mod, $modGmt, $p['id']]);
            $stmt   = $conn->prepare($sql);
            $stmt->bind_param($types, ...$values);
            $stmt->execute();
        }
        $conn->commit();
    } catch (Throwable $e) {
        $conn->rollback();
        respond(['status' => 'error', 'message' => 'Save failed, nothing was written: ' . $e->getMessage()], 500);
    }

    respond([
        'status'   => 'success',
        'updated'  => count($planned),
        'modified' => $mod,
        // The saved values as stored, so the UI can sync (e.g. sanitized slugs).
        'items'    => array_map(fn($p) => ['id' => $p['id']] + $p['set'], $planned),
    ]);
}

respond(['status' => 'error', 'message' => 'Unknown action'], 400);
