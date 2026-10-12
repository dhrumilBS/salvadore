<?php
/*
 * Find & Replace tab - shared backend (ported from ../../replace/api/lib.php).
 *
 * Loaded after api/bootstrap.php, which already gives us $conn pinned to the
 * ?db= site, $ACTIVE_DB, json_out() and require_post_method().
 *
 * Matching is done in PHP (the SQL LIKE is only a cheap pre-filter), so the
 * count shown, the preview and the actual write always agree. Values are
 * replaced according to their format:
 *   - plain text / HTML   straight replace
 *   - JSON (Elementor)    the find/replace text is matched both raw and
 *                         JSON-escaped ("https:\/\/..."), and the replacement
 *                         is escaped so the JSON stays valid
 *   - PHP-serialized      unserialized, replaced string by string, serialized
 *                         again so byte lengths stay right; values holding
 *                         objects are reported and never written
 *
 * Journal (undo): backups/replace-history-<site>.jsonl is the index (one JSON
 * line per event) and backups/replace-op-<id>.json holds every changed
 * field's before/after value. backups/ is web-blocked by its .htaccess.
 */
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
header('Cache-Control: no-store');

const FR_MAX_FIELDS   = 1000;  // fields returned by one search / replaced by one request
const FR_MAX_SNIPPETS = 4;     // previews per field
const FR_CONTEXT      = 60;    // characters of context either side of a match
const FR_BACKUP_DIR   = __DIR__ . '/../../backups';
const FR_POST_COLS    = ['post_title', 'post_content', 'post_excerpt'];

/** Meta keys that are caches, file paths or editor locks - never content. */
const FR_SKIP_META = [
    '_edit_lock', '_edit_last', '_wp_attachment_metadata', '_wp_attached_file', '_wp_old_slug', '_wp_old_date',
    '_elementor_css', '_elementor_controls_usage', '_elementor_inline_svg', '_elementor_page_assets',
    '_elementor_element_cache', '_elementor_version', '_elementor_pro_version', '_elementor_edit_mode',
    '_elementor_template_type', '_wp_page_template', '_thumbnail_id',
];

/** Post types that hold no editable content. */
const FR_SKIP_TYPES = [
    'revision', 'attachment', 'nav_menu_item', 'customize_changeset', 'oembed_cache', 'user_request',
    'custom_css', 'wp_global_styles', 'wp_font_family', 'wp_font_face', 'acf-field', 'acf-field-group',
    'elementor_font', 'elementor_icons', 'cf7_to_any_api', 'frm_styles', 'frm_form_actions',
];

const FR_STATUSES = ['publish', 'draft', 'pending', 'private', 'future'];

/** Searchable areas: key => label. */
const FR_SCOPES = [
    'title'     => 'Titles',
    'content'   => 'Content',
    'excerpt'   => 'Excerpts',
    'elementor' => 'Elementor data',
    'seo'       => 'SEO (Yoast)',
    'meta'      => 'Other custom fields',
];

/** The JSON body of a POST request (api() sends JSON.stringify(...) as the body). */
function fr_body(): array
{
    static $body = null;
    if ($body === null) {
        $decoded = json_decode(file_get_contents('php://input') ?: '', true);
        $body = is_array($decoded) ? $decoded : [];
    }
    return $body;
}

/* ───────────────────────── Options ───────────────────────── */

/** Validate and normalise the search options sent by the page. */
function fr_options(array $in): array
{
    $find = is_string($in['find'] ?? null) ? $in['find'] : '';
    if (mb_strlen(trim($find)) < 2) {
        json_out(false, 'Type at least 2 characters to find.');
    }
    $scopes = array_values(array_intersect(array_keys(FR_SCOPES), (array) ($in['scopes'] ?? [])));
    $statuses = array_values(array_intersect(FR_STATUSES, (array) ($in['statuses'] ?? [])));
    $types = array_values(array_filter((array) ($in['types'] ?? []), fn($t) => is_string($t) && preg_match('/^[a-z0-9_\-]{1,40}$/i', $t)));
    return [
        'find'      => $find,
        'replace'   => is_scalar($in['replace'] ?? null) ? (string) $in['replace'] : '',
        'case'      => !empty($in['case']),
        'word'      => !empty($in['word']),
        'skipTags'  => !empty($in['skipTags']),
        'scopes'    => $scopes ?: array_keys(FR_SCOPES),
        'statuses'  => $statuses ?: FR_STATUSES,
        'types'     => $types,
        'ids'       => array_values(array_filter(array_map('intval', preg_split('/[\s,]+/', is_scalar($in['ids'] ?? null) ? (string) $in['ids'] : '')))),
    ];
}

/* ───────────────────────── Matching ───────────────────────── */

/** JSON-escape a string fragment the way WordPress/Elementor store it (slashes and non-ASCII escaped). */
function fr_json_fragment(string $s): string
{
    $j = json_encode($s, JSON_INVALID_UTF8_SUBSTITUTE);
    return $j === false ? $s : substr($j, 1, -1);
}

/**
 * Build the matcher for one stored format.
 * Returns [regex, map] where map[matchedText(lowercased if case-insensitive)] => replacement.
 */
function fr_matcher(array $o, string $format): array
{
    $pairs = [[$o['find'], $o['replace']]];
    if ($format === 'json') {
        $jf = fr_json_fragment($o['find']);
        $jr = fr_json_fragment($o['replace']);
        // Stored escaped (e.g. "https:\/\/") - and, for the raw form, keep the replacement valid JSON.
        $pairs = [[$jf, $jr]];
        if ($jf !== $o['find']) {
            $pairs[] = [$o['find'], $jr];
        }
    }
    $alts = [];
    foreach ($pairs as [$f]) {
        $alts[] = preg_quote($f, '/');
    }
    $core = '(?:' . implode('|', $alts) . ')';
    if ($o['word']) {
        $core = '(?<![\p{L}\p{N}_])' . $core . '(?![\p{L}\p{N}_])';
    }
    // Group 1 = an HTML tag to leave alone (only when "ignore HTML tags" is on).
    $regex = '/' . ($o['skipTags'] ? '(<[^<>]*>)|' : '') . '(' . $core . ')/u' . ($o['case'] ? '' : 'i');
    $map = [];
    foreach ($pairs as [$f, $r]) {
        $map[$o['case'] ? $f : mb_strtolower($f)] = $r;
    }
    return [$regex, $map];
}

/**
 * Replace in one plain string. Returns [newText, matchCount, snippets].
 * Snippets: [{before, match, after, replacement}] for the first few matches.
 */
function fr_replace_string(string $text, array $o, string $format, bool $wantSnippets = false): array
{
    [$regex, $map] = fr_matcher($o, $format);
    $count = 0;
    $snips = [];
    $cb = function ($m) use (&$count, &$snips, $map, $o, $text, $wantSnippets, $format) {
        if (isset($m[1]) && $m[1][0] !== '' && $m[1][1] >= 0 && $o['skipTags']) {
            return $m[1][0];
        }
        $hit = $m[$o['skipTags'] ? 2 : 1];
        $key = $o['case'] ? $hit[0] : mb_strtolower($hit[0]);
        $rep = $map[$key] ?? reset($map);
        $count++;
        if ($wantSnippets && count($snips) < FR_MAX_SNIPPETS) {
            $pos = $hit[1];
            $start = max(0, $pos - FR_CONTEXT * 2);
            $before = substr($text, $start, $pos - $start);
            $after = substr($text, $pos + strlen($hit[0]), FR_CONTEXT * 2);
            $json = $format === 'json';
            $snips[] = [
                'before'      => fr_trim_context($before, true, $json),
                'match'       => $json ? fr_unjson($hit[0]) : $hit[0],
                'after'       => fr_trim_context($after, false, $json),
                'replacement' => $json ? fr_unjson($rep) : $rep,
            ];
        }
        return $rep;
    };
    $out = @preg_replace_callback($regex, $cb, $text, -1, $n, PREG_OFFSET_CAPTURE);
    if ($out === null) {
        // Not valid UTF-8 (old latin1 rows): retry byte-wise.
        $count = 0;
        $snips = [];
        $out = @preg_replace_callback(substr($regex, 0, strrpos($regex, '/')) . '/' . ($o['case'] ? '' : 'i'), $cb, $text, -1, $n, PREG_OFFSET_CAPTURE);
        $out ??= $text;
    }
    return [$out, $count, $snips];
}

/** Cut context to roughly FR_CONTEXT readable characters, on a word boundary, UTF-8 safe. */
function fr_trim_context(string $s, bool $fromEnd, bool $json = false): string
{
    $s = mb_convert_encoding($s, 'UTF-8', 'UTF-8');
    if ($json) {
        // Keep only the JSON string the match sits in, not the surrounding keys/brackets.
        $str = '(?:[^"\\\\]|\\\\.)*';
        if (preg_match($fromEnd ? "/(?:^|\")($str)$/s" : "/^($str)/s", $s, $m)) {
            $s = $m[1];
        }
        $s = fr_unjson($s);
    }
    $s = str_replace(["\r", "\n", "\t"], ' ', $s);
    if (mb_strlen($s) <= FR_CONTEXT) {
        return $s;
    }
    $cut = $fromEnd ? mb_substr($s, -FR_CONTEXT) : mb_substr($s, 0, FR_CONTEXT);
    $cut = $fromEnd ? preg_replace('/^\S*\s/u', '', $cut) : preg_replace('/\s\S*$/u', '', $cut);
    return $fromEnd ? '…' . $cut : $cut . '…';
}

/** Show a JSON-escaped fragment as readable text ("https:\/\/" -> "https://", "é" -> "é"). */
function fr_unjson(string $s): string
{
    $s = preg_replace_callback('/\\\\u([0-9a-fA-F]{4})/', fn($m) => mb_chr(hexdec($m[1]), 'UTF-8') ?: $m[0], $s);
    return str_replace(['\\/', '\\"', '\\n', '\\r', '\\t', '\\\\'], ['/', '"', ' ', ' ', ' ', '\\'], $s);
}

/** What a stored value is: 'serialized', 'json' or 'text'. */
function fr_format(string $value): string
{
    if (fr_is_serialized($value)) {
        return 'serialized';
    }
    $c = $value[0] ?? '';
    if (($c === '[' || $c === '{') && json_decode($value) !== null) {
        return 'json';
    }
    return 'text';
}

function fr_is_serialized(string $v): bool
{
    if ($v === 'b:0;' || $v === 'N;') {
        return true;
    }
    return (bool) preg_match('/^(a|O|s|i|d|b):[0-9:]/', $v) && in_array(substr(rtrim($v), -1), [';', '}'], true);
}

/**
 * Replace in a stored value of any format.
 * Returns ['value' => new, 'count' => n, 'snippets' => [...], 'format' => f, 'blocked' => reason|null].
 */
function fr_apply(string $value, array $o, bool $wantSnippets = false): array
{
    $format = fr_format($value);
    if ($format !== 'serialized') {
        [$new, $count, $snips] = fr_replace_string($value, $o, $format, $wantSnippets);
        if ($format === 'json' && $count && json_decode($new) === null) {
            return ['value' => $value, 'count' => $count, 'snippets' => $snips, 'format' => $format, 'blocked' => 'Replacing here would break the JSON, so this field is left as is.'];
        }
        return ['value' => $new, 'count' => $count, 'snippets' => $snips, 'format' => $format, 'blocked' => null];
    }

    $data = @unserialize($value, ['allowed_classes' => false]);
    if ($data === false && $value !== 'b:0;') {
        return ['value' => $value, 'count' => 0, 'snippets' => [], 'format' => $format, 'blocked' => 'Stored data is damaged, so it is left as is.'];
    }
    $count = 0;
    $snips = [];
    $hasObject = false;
    $walk = function ($v) use (&$walk, &$count, &$snips, &$hasObject, $o, $wantSnippets) {
        if (is_string($v)) {
            [$nv, $c, $s] = fr_replace_string($v, $o, fr_format($v) === 'json' ? 'json' : 'text', $wantSnippets && count($snips) < FR_MAX_SNIPPETS);
            $count += $c;
            $snips = array_slice(array_merge($snips, $s), 0, FR_MAX_SNIPPETS);
            return $nv;
        }
        if (is_array($v)) {
            $out = [];
            foreach ($v as $k => $item) {
                $out[$k] = $walk($item);
            }
            return $out;
        }
        if (is_object($v)) {
            $hasObject = true;
        }
        return $v;
    };
    $newData = $walk($data);
    if ($hasObject) {
        // Count matches in the raw bytes so the user still sees the field.
        [, $c, $s] = fr_replace_string($value, $o, 'text', $wantSnippets);
        return ['value' => $value, 'count' => max($count, $c), 'snippets' => $snips ?: $s, 'format' => $format, 'blocked' => 'Holds PHP objects, which can\'t be rewritten safely here.'];
    }
    return ['value' => $count ? serialize($newData) : $value, 'count' => $count, 'snippets' => $snips, 'format' => $format, 'blocked' => null];
}

/* ───────────────────────── Queries ───────────────────────── */

/** WHERE clause + params limiting wp_posts p to the chosen types / statuses / IDs. */
function fr_post_where(array $o): array
{
    $sql = ['p.post_type NOT IN (' . implode(',', array_fill(0, count(FR_SKIP_TYPES), '?')) . ')'];
    $params = FR_SKIP_TYPES;
    $sql[] = 'p.post_status IN (' . implode(',', array_fill(0, count($o['statuses']), '?')) . ')';
    array_push($params, ...$o['statuses']);
    if ($o['types']) {
        $sql[] = 'p.post_type IN (' . implode(',', array_fill(0, count($o['types']), '?')) . ')';
        array_push($params, ...$o['types']);
    }
    if ($o['ids']) {
        $sql[] = 'p.ID IN (' . implode(',', array_fill(0, count($o['ids']), '?')) . ')';
        array_push($params, ...$o['ids']);
    }
    return [implode(' AND ', $sql), $params];
}

/** LIKE patterns that pre-filter rows (raw text, plus the JSON-escaped form for Elementor). */
function fr_like_patterns(array $o): array
{
    $esc = fn($s) => '%' . addcslashes($s, '%_\\') . '%';
    return array_values(array_unique([$esc($o['find']), $esc(fr_json_fragment($o['find']))]));
}

function fr_run(mysqli $conn, string $sql, array $params): array
{
    $stmt = $conn->prepare($sql);
    $stmt->execute($params ? array_map('strval', $params) : null);
    return $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
}

/** Which meta scope a meta key belongs to. */
function fr_meta_scope(string $key): string
{
    if ($key === '_elementor_data') {
        return 'elementor';
    }
    if (str_starts_with($key, '_yoast_wpseo_')) {
        return 'seo';
    }
    return 'meta';
}

/** Scope key for a candidate row. */
function fr_row_scope(array $r): string
{
    return $r['kind'] === 'post'
        ? ['post_title' => 'title', 'post_content' => 'content', 'post_excerpt' => 'excerpt'][$r['field']]
        : fr_meta_scope($r['field']);
}

/**
 * Candidate fields for a search, as rows:
 *   ['kind' => 'post'|'meta', 'id' => postID|metaID, 'post_id', 'field' => column|meta_key, 'value']
 * Returns [rows, truncated]. truncated is true when any query hit its row limit,
 * i.e. there may be more matching rows than were looked at.
 */
function fr_candidates(mysqli $conn, array $o, int $limit): array
{
    [$where, $params] = fr_post_where($o);
    $likes = fr_like_patterns($o);
    $bin = $o['case'] ? 'BINARY ' : '';
    $rows = [];
    $truncated = false;

    $cols = array_intersect_key(['title' => 'post_title', 'content' => 'post_content', 'excerpt' => 'post_excerpt'], array_flip($o['scopes']));
    foreach ($cols as $col) {
        $cond = implode(' OR ', array_map(fn() => "p.$col LIKE $bin?", $likes));
        $found = fr_run($conn, "SELECT p.ID, p.$col AS v FROM wp_posts p WHERE $where AND ($cond) ORDER BY p.ID DESC LIMIT " . ($limit + 1), array_merge($params, $likes));
        if (count($found) > $limit) {
            $truncated = true;
            $found = array_slice($found, 0, $limit);
        }
        foreach ($found as $r) {
            $rows[] = ['kind' => 'post', 'id' => (int) $r['ID'], 'post_id' => (int) $r['ID'], 'field' => $col, 'value' => (string) $r['v']];
        }
    }

    $metaScopes = array_intersect(['elementor', 'seo', 'meta'], $o['scopes']);
    if ($metaScopes) {
        $keySql = [];
        $keyParams = [];
        if (in_array('elementor', $metaScopes, true)) {
            $keySql[] = "m.meta_key = '_elementor_data'";
        }
        if (in_array('seo', $metaScopes, true)) {
            $keySql[] = "m.meta_key LIKE '\\_yoast\\_wpseo\\_%'";
        }
        if (in_array('meta', $metaScopes, true)) {
            $keySql[] = "(m.meta_key <> '_elementor_data' AND m.meta_key NOT LIKE '\\_yoast\\_wpseo\\_%' AND m.meta_key NOT IN (" . implode(',', array_fill(0, count(FR_SKIP_META), '?')) . '))';
            $keyParams = FR_SKIP_META;
        }
        $cond = implode(' OR ', array_map(fn() => "m.meta_value LIKE $bin?", $likes));
        $found = fr_run(
            $conn,
            'SELECT m.meta_id, m.post_id, m.meta_key, m.meta_value FROM wp_postmeta m JOIN wp_posts p ON p.ID = m.post_id
             WHERE ' . $where . ' AND (' . implode(' OR ', $keySql) . ") AND ($cond) ORDER BY m.post_id DESC, m.meta_id LIMIT " . ($limit + 1),
            array_merge($params, $keyParams, $likes)
        );
        if (count($found) > $limit) {
            $truncated = true;
            $found = array_slice($found, 0, $limit);
        }
        foreach ($found as $r) {
            $rows[] = ['kind' => 'meta', 'id' => (int) $r['meta_id'], 'post_id' => (int) $r['post_id'], 'field' => $r['meta_key'], 'value' => (string) $r['meta_value']];
        }
    }
    return [$rows, $truncated];
}

/** title / type / status for a set of post IDs. */
function fr_posts_info(mysqli $conn, array $ids): array
{
    if (!$ids) {
        return [];
    }
    $ids = array_values(array_unique($ids));
    $out = [];
    foreach (array_chunk($ids, 500) as $chunk) {
        $rows = fr_run($conn, 'SELECT ID, post_title, post_type, post_status, post_modified FROM wp_posts WHERE ID IN (' . implode(',', array_fill(0, count($chunk), '?')) . ')', $chunk);
        foreach ($rows as $r) {
            $out[(int) $r['ID']] = ['id' => (int) $r['ID'], 'title' => $r['post_title'], 'type' => $r['post_type'], 'status' => $r['post_status'], 'modified' => $r['post_modified']];
        }
    }
    return $out;
}

function fr_home_url(mysqli $conn): string
{
    $r = fr_run($conn, "SELECT option_value FROM wp_options WHERE option_name = 'home' LIMIT 1", []);
    return rtrim((string) ($r[0]['option_value'] ?? ''), '/');
}

/* ───────────────────────── Journal (undo) ───────────────────────── */

function fr_journal_index(string $site): string
{
    return FR_BACKUP_DIR . '/replace-history-' . preg_replace('/[^a-z0-9_\-]/i', '', $site) . '.jsonl';
}

function fr_journal_file(string $id): string
{
    return FR_BACKUP_DIR . '/replace-op-' . preg_replace('/[^a-z0-9\-]/i', '', $id) . '.json';
}

/**
 * Every operation for a site, newest first, with undo state merged in.
 * Index events: 'replace' (written before the commit), 'aborted' (the commit
 * failed after that, so the replace never happened) and 'undo'.
 */
function fr_journal_list(string $site): array
{
    $file = fr_journal_index($site);
    if (!is_file($file)) {
        return [];
    }
    $ops = [];
    foreach (file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $e = json_decode($line, true);
        if (!is_array($e) || empty($e['id']) || !is_string($e['id'])) {
            continue;
        }
        $event = $e['event'] ?? 'replace';
        if ($event === 'undo') {
            if (isset($ops[$e['id']])) {
                $ops[$e['id']]['undone'] = $e['time'];
                $ops[$e['id']]['undoSkipped'] = $e['skipped'] ?? 0;
            }
            continue;
        }
        if ($event === 'aborted') {
            unset($ops[$e['id']]);
            continue;
        }
        $ops[$e['id']] = $e;
    }
    return array_reverse(array_values($ops));
}

function fr_ensure_backup_dir(): bool
{
    return is_dir(FR_BACKUP_DIR) || @mkdir(FR_BACKUP_DIR, 0775, true) || is_dir(FR_BACKUP_DIR);
}

/** Append one event line to the site's index. Returns false if it could not be written. */
function fr_journal_append(string $site, array $entry): bool
{
    if (!fr_ensure_backup_dir()) {
        return false;
    }
    $line = json_encode($entry, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    if ($line === false) {
        return false;
    }
    return @file_put_contents(fr_journal_index($site), $line . "\n", FILE_APPEND | LOCK_EX) !== false;
}

/**
 * Undo one replace operation (shared by replace_undo.php and the unified
 * History's activity_undo.php). Restores a field only while it still equals
 * what the replace wrote; anything edited since is skipped and reported.
 * Returns ['success' => bool, 'msg' => string, + restored/skipped/logged on success].
 */
function fr_undo_op(mysqli $conn, string $site, string $id): array
{
    $op = null;
    foreach (fr_journal_list($site) as $e) {
        if ($e['id'] === $id) {
            $op = $e;
        }
    }
    $file = fr_journal_file($id);
    if ($id === '' || !$op || !is_file($file)) {
        return ['success' => false, 'msg' => 'That operation was not found for this site.'];
    }
    if (!empty($op['undone'])) {
        return ['success' => false, 'msg' => 'Already undone.'];
    }
    $data = json_decode((string) file_get_contents($file), true);
    if (!is_array($data) || ($data['site'] ?? '') !== $site || !is_array($data['changes'] ?? null)) {
        return ['success' => false, 'msg' => 'The backup for this operation is unreadable.'];
    }

    $restored = 0;
    $skipped = [];
    $conn->begin_transaction();
    try {
        foreach ($data['changes'] as $c) {
            if ($c['kind'] === 'post' && in_array($c['field'], FR_POST_COLS, true)) {
                $cur = fr_run($conn, "SELECT {$c['field']} AS v FROM wp_posts WHERE ID = ? FOR UPDATE", [$c['id']])[0]['v'] ?? null;
                $sql = "UPDATE wp_posts SET {$c['field']} = ? WHERE ID = ?";
            } elseif ($c['kind'] === 'meta') {
                $cur = fr_run($conn, 'SELECT meta_value AS v FROM wp_postmeta WHERE meta_id = ? FOR UPDATE', [$c['id']])[0]['v'] ?? null;
                $sql = 'UPDATE wp_postmeta SET meta_value = ? WHERE meta_id = ?';
            } else {
                continue;
            }
            if ($cur === null || $cur !== $c['after']) {
                $skipped[] = ['post_id' => $c['post_id'], 'field' => $c['field'], 'reason' => $cur === null ? 'Deleted since.' : 'Edited again since - left as is.'];
                continue;
            }
            $stmt = $conn->prepare($sql);
            $stmt->bind_param('si', $c['before'], $c['id']);
            $stmt->execute();
            $restored++;
        }
        $conn->commit();
    } catch (Throwable $e) {
        $conn->rollback();
        return ['success' => false, 'msg' => $e->getMessage()];
    }

    $logged = fr_journal_append($site, ['event' => 'undo', 'id' => $id, 'time' => date('c'), 'restored' => $restored, 'skipped' => count($skipped)]);
    $msg = "Restored $restored " . ($restored === 1 ? 'field' : 'fields') . ($skipped ? ', ' . count($skipped) . ' skipped (edited again since)' : '') . '.';
    if (!$logged) {
        $msg .= ' History could not be updated, so it may still show Undo.';
    }
    return ['success' => true, 'msg' => $msg, 'restored' => $restored, 'skipped' => $skipped, 'logged' => $logged, 'op' => $op];
}
